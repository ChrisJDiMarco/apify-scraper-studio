// A research program's one page: its name, schedule and Run now in the header, then tabs. Runs lists what it has found;
// the other tabs are the program's settings, one group per tab (program-editor.jsx's groups, the same fields as the
// quick-edit drawer). The whole program is one draft with one Save bar, whichever tab an edit was made on: a save sends
// the whole program and its checks cross groups, so tabs are a way to look at the form, not separate forms.
// Unsaved edits are guarded (the sidebar, Back and the browser tab ask first), turning a schedule on asks with the caps
// and the estimate, and a save over someone else's newer one is refused and says so, as in the drawer.
//
// program   the saved program (the page closes with a note if it leaves the workspace)
// tab       'runs' or a PROGRAM_GROUPS id; onTab(next)
// runs      this program's research runs, newest first
// onOpenRun(runId), onStartResearch(program), onBack()
import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Radar, TriangleAlert } from 'lucide-react';
import { useConfirm } from './confirm-dialog.jsx';
import { useUnsavedGuard } from './asset-editor.jsx';
import { can as canCall, formatTime, hasCapability, writeProps } from './viewer.js';
import { formatDate, friendlyMessage, number } from './ui.jsx';
import { researchCostLinesFrom } from './studio-actions.js';
import { PROGRAM_GROUPS, ProgramEditorFields, checkDraft, draftKey, programDraft, programPayload } from './program-editor.jsx';
import { scheduleSummary, scheduledDate } from './program-summary.js';
import './program-drawer.css';

const list = (value) => (Array.isArray(value) ? value : []);
const isElectron = () => typeof navigator !== 'undefined' && /Electron\//.test(navigator.userAgent || '');
const conflictOf = (error) => error?.status === 409 || error?.code === 'saveConflict' || /after you opened it/i.test(String(error?.message || ''));
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
// Shorter names on the tabs than the form's own group titles.
const TAB_LABELS = { basics: 'Name & focus', sources: 'Sources', when: 'Schedule', budgets: 'Budget', ai: 'AI models', automation: 'Automation', advanced: 'Advanced' };
export const PROGRAM_TABS = Object.freeze([['runs', 'Runs'], ...PROGRAM_GROUPS.map(([id, label]) => [id, TAB_LABELS[id] || label])]);
export const programTab = (value) => (PROGRAM_TABS.some(([id]) => id === value) ? value : 'runs');
const RUN_STATUS = { queued: 'Queued', running: 'Running', 'awaiting-review': 'Waiting for your OK', succeeded: 'Finished', partial: 'Finished in part', failed: 'Stopped', cancelled: 'Cancelled' };
const RUN_TONE = { queued: 'working', running: 'working', 'awaiting-review': 'action', succeeded: 'done', partial: 'attention', failed: 'attention', cancelled: 'muted' };

// One row per research run: when, how it ended, what it found and (for roles that see money) what it cost.
export function runRows(runs) {
  return list(runs).map((run) => {
    const found = list(run.discoveredThemes).length || list(run.themes).length;
    const waiting = run.status === 'awaiting-review';
    return { id: run.id, at: run.createdAt || '', status: run.status || '', label: RUN_STATUS[run.status] || String(run.status || ''), tone: RUN_TONE[run.status] || 'muted', found,
      approved: waiting ? Object.values(run.decisions || {}).filter((value) => value === 'approved').length : list(run.themes).length, reports: list(run.reportRunIds).length,
      costUsd: Number.isFinite(Number(run.costUsd)) && run.costUsd !== null && run.costUsd !== '' ? Number(run.costUsd) : null, by: run.startedByName || run.byName || (run.scheduled ? 'Schedule' : ''), message: typeof run.error === 'string' ? run.error : run.error?.message || '' };
  });
}

export function ProgramPage({ program, missing = false, workspace, state = {}, api = {}, viewer = {}, busy = false, tab = 'runs', onTab, runs = [], onOpenRun, onStartResearch, onBack, onSaved, onNotice }) {
  const can = (method) => canCall(viewer, method);
  const confirm = useConfirm();
  const guard = useUnsavedGuard();
  const guardKey = useId();
  const nameRef = useRef(null);
  const [draft, setDraftState] = useState(() => programDraft(program, workspace?.id));
  const baseline = useRef(draftKey(draft));
  const base = useRef(program?.updatedAt || '');
  const [error, setError] = useState(null); // { message, group }
  const [conflict, setConflict] = useState(null); // { at } once someone else saved
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const estimate = useRef(null);
  const dirty = draftKey(draft) !== baseline.current;
  const setDraft = (update) => { setDraftState(update); setNote(''); };
  const preview = Boolean(viewer.preview);
  const mayEdit = can('saveResearchProgram') && typeof api.saveResearchProgram === 'function';
  const codex = state.contentStudio?.capabilities?.aiProvider === 'codex';
  const seeCosts = hasCapability(viewer, 'seeCosts');
  const shown = programTab(tab);

  useEffect(() => { guard.set(guardKey, dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => guard.set(guardKey, false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty || isElectron() || typeof window === 'undefined') return undefined;
    const ask = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  function reset(next = program) {
    const fresh = programDraft(next, workspace?.id);
    baseline.current = draftKey(fresh); base.current = next?.updatedAt || '';
    setDraftState(fresh); setConflict(null); setError(null);
  }
  // Someone saved this program while it is open: an untouched draft follows silently; edits get a banner and a choice.
  useEffect(() => {
    if (missing) { guard.set(guardKey, false); onNotice?.('That program isn’t in this workspace anymore.'); onBack?.(); return; }
    if (!program?.updatedAt || program.updatedAt === base.current || saving) return;
    if (!dirty) { reset(program); setNote('Updated with the latest saved version.'); }
    else setConflict({ at: program.updatedAt });
  }, [program?.updatedAt, missing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function leave() {
    if (saving) return;
    if (dirty && !(await confirm({ title: `Discard changes to “${draft.name || program?.name || 'this program'}”?`, lines: ['Your edits to this program aren’t saved.'], confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return;
    guard.set(guardKey, false); onBack?.();
  }
  async function save(event, { force = false } = {}) {
    event?.preventDefault?.();
    if (saving || preview || !mayEdit) return;
    const problem = checkDraft(draft);
    // A problem on another tab opens that tab, so the field it names is on screen.
    if (problem) { setError(problem); if (problem.group && problem.group !== shown) onTab?.(problem.group); return; }
    setError(null);
    const turningOn = draft.schedule.enabled && draft.schedule.frequency !== 'manual' && !(program?.schedule?.enabled && program?.schedule?.frequency !== 'manual');
    if (turningOn) {
      const ok = await confirm({ title: `Turn on scheduled runs for “${draft.name}”?`, lines: [`${scheduleSummary(draft.schedule)}.`, ...researchCostLinesFrom(estimate.current, draft, { codex }), 'Keep the app or server running. Missed times don’t pile up.'], confirmLabel: 'Turn on schedule' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const result = await api.saveResearchProgram(programPayload(draft, workspace?.id, { baseUpdatedAt: force ? '' : base.current }));
      const saved = result?.program || result;
      // The page stays open on the saved program: the draft becomes the new baseline.
      const fresh = programDraft(saved?.id ? saved : { ...program, ...programPayload(draft, workspace?.id) }, workspace?.id);
      baseline.current = draftKey(fresh); base.current = saved?.updatedAt || base.current;
      setDraftState(fresh); setConflict(null); setNote('Saved.');
      onSaved?.(saved);
    } catch (failure) {
      if (conflictOf(failure)) setConflict({ at: '', message: friendlyMessage(failure?.message || failure) });
      else setError({ message: friendlyMessage(failure?.message || failure) || 'The program couldn’t be saved. Your changes are still here; try again.', group: '' });
    } finally { setSaving(false); }
  }
  function saveMine() {
    const newer = program?.updatedAt && program.updatedAt !== base.current;
    if (newer) base.current = program.updatedAt;
    setConflict(null); save(null, { force: !newer });
  }

  const recurring = draft.schedule.frequency !== 'manual';
  const meta = [scheduleSummary(draft.schedule), recurring ? (program?.schedule?.enabled && program.schedule.nextRunAt ? `Next run ${scheduledDate(program.schedule.nextRunAt, program.schedule.timeZone)}` : draft.schedule.enabled ? 'Starts at its next run time' : 'Paused') : 'On demand',
    seeCosts ? `Up to ${money(draft.budgets?.collectionUsd)} collection + ${money(draft.budgets?.aiUsd)} AI per run` : ''].filter(Boolean).join(' · ');
  const canRunNow = Boolean(program?.id) && typeof onStartResearch === 'function' && can('startResearchRun');
  const rows = runRows(runs);
  const status = dirty ? 'Unsaved changes' : note;

  return <div className="simple-page program-page" data-spot="program.page">
    <header className="trend-page-head">
      <div className="trend-page-top"><button type="button" className="simple-back" onClick={leave}><ArrowLeft size={15} aria-hidden="true" />Research programs</button></div>
      <div className="trend-page-title">
        <div><h1>{draft.name || program?.name || 'Research program'}</h1><p className="trend-page-detail">{meta}</p></div>
        <div className="simple-head-actions trend-page-actions">
          {canRunNow && <button type="button" className="simple-primary" data-spot="program.run" title={dirty ? 'Save your changes first' : undefined} {...writeProps(viewer, busy || dirty || saving)} onClick={() => onStartResearch(program)}><Radar size={15} aria-hidden="true" />Run now</button>}
        </div>
      </div>
      <div className="simple-segment trend-page-tabs" role="tablist" aria-label="This program">
        {PROGRAM_TABS.map(([id, label]) => <button type="button" role="tab" key={id} id={`program-tab-${id}`} aria-selected={shown === id} aria-controls="program-panel" onClick={() => onTab?.(id)}>{label}{id === 'runs' && rows.length > 0 && <span className="trend-tab-count">{number(rows.length)}</span>}{error?.group === id && <span className="pd-chip-dot" aria-label=", has a problem" />}</button>)}
      </div>
    </header>

    <div id="program-panel" role="tabpanel" aria-labelledby={`program-tab-${shown}`} className="trend-page-panel">
      {shown === 'runs' && (rows.length ? <div className="simple-file-table-wrap"><table className="simple-file-table program-runs">
        <thead><tr><th scope="col">Started</th><th scope="col">Status</th><th scope="col">Trends found</th><th scope="col">Approved</th><th scope="col">Reports</th>{seeCosts && <th scope="col">Cost</th>}<th scope="col"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <th scope="row">{row.at ? formatDate(row.at) : 'Undated'}{row.by && <small className="program-run-by"> · {row.by}</small>}</th>
          <td><span className="stage-chip" data-tone={row.tone}>{row.label}</span>{row.message && <small className="program-run-note">{row.message}</small>}</td>
          <td>{number(row.found)}</td><td>{number(row.approved)}</td><td>{number(row.reports)}</td>
          {seeCosts && <td>{row.costUsd === null ? (codex ? 'Not reported' : '') : money(row.costUsd)}</td>}
          <td className="program-run-open">{onOpenRun && <button type="button" className="simple-link" aria-label={`Open the run from ${row.at ? formatDate(row.at) : 'an unknown date'}`} onClick={() => onOpenRun(row.id)}>Open<ArrowRight size={14} aria-hidden="true" /></button>}</td>
        </tr>)}</tbody>
      </table></div>
        : <div className="simple-empty"><p>This program hasn’t run yet.{canRunNow ? ' Run now reads the sources it follows and brings back the trends it finds.' : ''}</p></div>)}

      {/* Every group stays mounted (one draft, and checks that cross groups); the tab decides which one shows. */}
      <form className="pd-sheet pp-fields" data-show={shown} hidden={shown === 'runs'} noValidate onSubmit={save}>
        <fieldset disabled={saving || preview || !mayEdit}>
          <ProgramEditorFields grouped idPrefix="pp" draft={draft} setDraft={setDraft} capabilities={state.contentStudio?.capabilities || {}} api={api} canEstimate={can('estimateResearchProgram')} onEdit={() => setError(null)} onEstimate={(result) => { estimate.current = result; }} nameRef={nameRef} errorGroup={error?.group || ''} />
        </fieldset>
        {!mayEdit && <p className="pd-status">Only people who manage research programs can change these settings.</p>}
      </form>
    </div>

    {mayEdit && (dirty || conflict || error?.message || note) && <footer className="pd-foot program-save-bar">
      <div className="pd-foot-status">
        {conflict ? <div className="pd-conflict" role="alert"><TriangleAlert size={15} aria-hidden="true" /><div><p>{conflict.at ? `Someone saved this program at ${formatTime(conflict.at)}. Saving now would replace their changes.` : conflict.message || 'Someone saved this program after you opened it. Saving now would replace their changes.'}</p>
          <div className="pd-conflict-actions"><button type="button" className="studio-quiet small" onClick={() => reset(program)}>Use their version</button><button type="button" className="studio-quiet small" {...writeProps(viewer, saving)} onClick={saveMine}>Save mine anyway</button></div></div></div>
          : error?.message ? <p className="pd-error" role="alert">{error.message}</p>
            : <p className="pd-status" role="status">{status}</p>}
      </div>
      <div className="pd-foot-actions">
        <button type="button" className="simple-quiet" disabled={!dirty || saving} onClick={() => { reset(program); setNote(''); }}>Discard</button>
        <button type="button" className="simple-primary" {...writeProps(viewer, saving || !dirty)} onClick={save}>{saving ? 'Saving…' : <><Check size={15} aria-hidden="true" />Save program</>}</button>
      </div>
    </footer>}
  </div>;
}
