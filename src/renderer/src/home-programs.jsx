import React, { useRef, useState } from 'react';
import { ArrowRight, CalendarClock, CircleStop, History, LoaderCircle, Pencil, Plus, Radar, Users, Wallet } from 'lucide-react';
import { MoreMenu } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { can as canCall, hasCapability, useViewer, writeProps } from './viewer.js';
import { friendlyMessage, number } from './ui.jsx';
import { CODEX_UNCAPPED } from './studio-actions.js';
import { programSummaries, scheduledDate } from './program-summary.js';
import { ProgramDrawer } from './program-drawer.jsx';
import './home-programs.css';

// Home → Research programs (admins with Manage research programs), and the Research programs page itself (`page`: every
// program, no "All programs" link): each program's schedule, next and last run, sources and budgets, with Run now (the
// layout's own confirmation shows the estimate first), Edit (Workbench → Edit research program when `onEditProgram` is
// given, else the quick-edit drawer with every setting) and Pause or Resume schedule (Resume confirms the per-run caps).
// Add program opens the drawer empty. Money shows only with See costs. While a program's run is going, its row wears a
// moving border, says what the run is doing, and offers Cancel in place of Run now (behind the studio's confirmation).
// A run waiting for someone's OK is not "running": it keeps its Needs your OK chip and Run now.
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '—');
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const day = (value) => { const date = new Date(value || 0); return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };

// The dot beside a last run's status.
const RUN_TONE = { succeeded: 'ok', partial: 'warn', failed: 'bad', cancelled: 'muted' };

function statusChip(row) {
  if (row.activeRun?.status === 'awaiting-review') return { tone: 'review', label: 'Needs your OK' };
  if (row.activeRun) return { tone: 'active', label: 'Running' };
  if (row.schedule.problem) return { tone: 'problem', label: 'Schedule paused' };
  if (row.lastRun?.status === 'failed') return { tone: 'problem', label: 'Stopped' };
  return null;
}

export function ProgramsPanel({ state = {}, viewer: viewerIn, api = {}, busy = false, needsSetup = false, onStartResearch, onOpenTarget, onNotice, onOpenProgramPage, onEditProgram, onPeople, onAddProgram, limit = 5, page = false }) {
  const contextViewer = useViewer(); const viewer = viewerIn || contextViewer;
  const can = (method) => canCall(viewer, method);
  const confirm = useConfirm();
  const anchor = useRef(null);
  const studio = state.contentStudio || {};
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId) || null;
  const mine = (row) => !workspace || !row?.workspaceId || row.workspaceId === workspace.id;
  const programs = list(studio.programs).filter(mine);
  const rows = programSummaries({ programs, researchRuns: list(studio.researchRuns).filter(mine) });
  const seeCosts = hasCapability(viewer, 'seeCosts');
  const codexStudio = studio.capabilities?.aiProvider === 'codex';
  const canRun = can('startResearchRun') && typeof onStartResearch === 'function';
  const [open, setOpen] = useState(null); // null (closed), 'new', or a program id
  const [problem, setProblem] = useState('');
  const [working, setWorking] = useState('');
  const notice = (message) => (onNotice ? onNotice(message) : undefined);

  async function saveSchedule(row, enabled) {
    const program = row.program;
    if (enabled) {
      const next = scheduledDate(row.program.schedule?.nextRunAt, row.program.schedule?.timeZone);
      const ok = await confirm({ title: `Resume “${row.name}”?`, lines: [next ? `Next run ${next}.` : `It runs ${row.schedule.summary.replace(/^Every/, 'every')}.`, seeCosts ? `Each run can spend up to ${money(row.budgets.collectionUsd)} on collection and ${money(row.budgets.aiUsd)} on AI.` : '', codexStudio || row.lastRun?.route === 'codex' ? CODEX_UNCAPPED : '', 'Keep the app or server running. Missed times don’t pile up.'].filter(Boolean), confirmLabel: 'Resume schedule' });
      if (!ok) return;
    }
    setWorking(row.id); setProblem('');
    try {
      const saved = await api.saveResearchProgram({ ...program, schedule: { ...program.schedule, enabled }, workspaceId: program.workspaceId || workspace?.id, ...(program.updatedAt ? { baseUpdatedAt: program.updatedAt } : {}) });
      notice(enabled ? `Schedule resumed for “${row.name}”.${saved?.schedule?.nextRunAt ? ` Next run ${scheduledDate(saved.schedule.nextRunAt, saved.schedule.timeZone)}.` : ''}` : `Schedule paused for “${row.name}”. A run already going isn’t stopped.`);
    } catch (error) { setProblem(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'The schedule couldn’t be changed. Try again.'); }
    finally { setWorking(''); }
  }

  async function cancelRun(row) {
    const ok = await confirm({ title: `Cancel the run of “${row.name}”?`, lines: ['What it has collected so far is kept. Nothing more is spent after it stops.'], confirmLabel: 'Cancel run', cancelLabel: 'Keep it running', tone: 'danger' });
    if (!ok) return;
    setWorking(row.id); setProblem('');
    try { await api.cancelStudioRun({ runId: row.activeRun.id }); notice(`Cancelled the run of “${row.name}”.`); }
    catch (error) { setProblem(friendlyMessage(error?.message || error) || 'The run couldn’t be cancelled. Try again.'); }
    finally { setWorking(''); }
  }

  const canCancel = can('cancelStudioRun') && typeof api.cancelStudioRun === 'function';
  const shown = rows.slice(0, limit);
  // Edit: the full editor in Workbench → Edit research program when the shell offers it, else the quick-edit drawer.
  const edit = (id) => (onEditProgram ? onEditProgram(id) : setOpen(id));
  const editing = open === 'new' ? null : programs.find((program) => program.id === open) || null;
  return <section className="wb-card hp-card" aria-labelledby="hp-title" data-spot="home.programs" ref={anchor}>
    <header className="wb-card-head"><span className="wb-icon tone-purple" aria-hidden="true"><Radar size={17} /></span><h2 id="hp-title"><span className="wb-title-text">Research programs</span> <span className="wb-count">{number(rows.length)}</span></h2>
      {!page && <button type="button" className="wb-link" onClick={() => onOpenTarget?.({ kind: 'page', id: 'programs', page: 'programs' })}>All programs<ArrowRight size={14} aria-hidden="true" /></button>}
    </header>
    {problem && <p className="wb-problem" role="alert">{problem}</p>}
    {shown.length ? <ul className="hp-list">{shown.map((row) => {
      const chip = statusChip(row);
      const codex = codexStudio || row.lastRun?.route === 'codex';
      const runTitle = needsSetup ? 'Connect Apify first' : !row.sources.total ? 'Add sources first' : undefined;
      const { byPlatform } = row.sources;
      const running = Boolean(row.activeRun) && row.activeRun.status !== 'awaiting-review';
      const doing = running ? friendlyMessage(row.activeRun.message) : '';
      return <li key={row.id} className={`hp-row${running ? ' is-running' : ''}`}>
        <div className="hp-head">
          <div className="hp-title">
            <div className="hp-line">
              <button type="button" className="hp-name" onClick={() => edit(row.id)}>{row.name}</button>
              {chip && (chip.tone === 'review' && onOpenTarget
                ? <button type="button" className={`hp-chip tone-${chip.tone}`} onClick={() => onOpenTarget({ kind: 'run', id: row.activeRun.id, page: 'research' })}>{chip.label}</button>
                : <span className={`hp-chip tone-${chip.tone}`} role={running ? 'status' : undefined}>{running && <LoaderCircle className="spin" size={12} aria-hidden="true" />}{chip.label}</span>)}
            </div>
            {doing && <p className="hp-meta hp-doing">{doing}</p>}
          </div>
          <div className="hp-actions">
            {running && canCancel ? <button type="button" className="wb-quiet hp-cancel" aria-label={`Cancel the run of “${row.name}”`} {...writeProps(viewer, Boolean(working))} onClick={() => cancelRun(row)}><CircleStop size={14} aria-hidden="true" />Cancel</button>
              : canRun && <button type="button" className="wb-primary" aria-label={`Run “${row.name}” now`} title={runTitle} {...writeProps(viewer, busy || needsSetup || !row.sources.total || Boolean(working) || running)} onClick={() => onStartResearch(row.program)}><Radar size={14} aria-hidden="true" />Run now</button>}
            <button type="button" className="wb-quiet" data-spot="programs.edit" data-spot-item={row.name} aria-label={`Edit “${row.name}”`} onClick={() => edit(row.id)}><Pencil size={14} aria-hidden="true" />Edit</button>
            <MoreMenu label={`More for ${row.name}`} disabled={Boolean(working)} items={[
              row.schedule.recurring && !viewer.preview && { label: row.schedule.enabled ? 'Pause schedule' : 'Resume schedule', onSelect: () => saveSchedule(row, !row.schedule.enabled), disabled: busy },
              onPeople && { label: 'People who see it', onSelect: () => onPeople(row.program) },
              onEditProgram && { label: 'Quick edit', onSelect: () => setOpen(row.id) },
              (onOpenProgramPage || onOpenTarget) && { label: 'Runs and results', onSelect: () => (onOpenProgramPage ? onOpenProgramPage(row.id) : onOpenTarget({ kind: 'program', id: row.id })) },
            ]} />
          </div>
        </div>
        {/* What the program is, at a glance: four labelled facts instead of a run of grey lines. */}
        <dl className="hp-facts">
          <div className="hp-fact"><dt><CalendarClock size={13} aria-hidden="true" />Schedule</dt>
            <dd className="hp-value">{row.schedule.recurring ? row.schedule.summary : 'On demand'}</dd>
            <dd className="hp-sub">{row.schedule.recurring ? [row.schedule.enabled ? 'Schedule on' : 'Paused', row.schedule.next ? `Next: ${row.schedule.next}` : ''].filter(Boolean).join(' · ') : 'Runs when you press Run now'}</dd></div>
          <div className="hp-fact"><dt><History size={13} aria-hidden="true" />Last run</dt>
            <dd className="hp-value">{row.lastRun ? <><span className={`hp-dot tone-${RUN_TONE[row.lastRun.status] || 'muted'}`} aria-hidden="true" />{day(row.lastRun.at)} · {readable(row.lastRun.status)}</> : 'No runs yet'}</dd>
            {seeCosts && row.lastRun && (codex || row.lastRun.costUsd !== null) && <dd className="hp-sub">{codex ? 'AI spend isn’t reported on Codex' : `Cost ${money(row.lastRun.costUsd)}`}</dd>}</div>
          <div className="hp-fact"><dt><Users size={13} aria-hidden="true" />Sources</dt>
            <dd className="hp-value">{row.sources.total ? `${number(row.sources.total)} followed` : 'None yet'}</dd>
            <dd className="hp-sub"><ul className="hp-chips" aria-label={`Sources for ${row.name}`}>
              {byPlatform.x > 0 && <li>X {number(byPlatform.x)}</li>}
              {byPlatform.reddit > 0 && <li>Reddit {number(byPlatform.reddit)}</li>}
              {byPlatform.linkedin > 0 && <li>LinkedIn {number(byPlatform.linkedin)}</li>}
              {row.sources.keywordSearch && <li>LinkedIn search</li>}
              {!row.sources.total && <li className="is-empty">No sources yet</li>}
            </ul></dd></div>
          {seeCosts && <div className="hp-fact"><dt><Wallet size={13} aria-hidden="true" />Budget per run</dt>
            <dd className="hp-value">Up to {money(row.budgets.collectionUsd + row.budgets.aiUsd)}</dd>
            <dd className="hp-sub">{money(row.budgets.collectionUsd)} collection + {money(row.budgets.aiUsd)} AI</dd></div>}
        </dl>
        {row.schedule.problem && <p className="hp-problem">Schedule paused: {row.schedule.problem}</p>}
        {!row.schedule.problem && row.schedule.skipped && <p className="hp-meta">{row.schedule.skipped}</p>}
      </li>;
    })}</ul> : <p className="wb-empty">No research programs yet. A program is the accounts and communities research follows, with its schedule and budgets.</p>}
    <div className="hp-foot">
      {/* Add program: the guided setup (suggested sources, brand, schedule) when the shell offers it, else the drawer. */}
      <button type="button" className="wb-quiet" data-spot="programs.add" {...writeProps(viewer, busy || !workspace)} onClick={() => (onAddProgram ? onAddProgram() : setOpen('new'))}><Plus size={14} aria-hidden="true" />Add program</button>
      {rows.length > limit && <button type="button" className="wb-link" onClick={() => onOpenTarget?.({ kind: 'page', id: 'programs', page: 'programs' })}>See all {number(rows.length)}<ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
    {open && workspace && <ProgramDrawer key={open} program={editing} missing={open !== 'new' && !editing} workspace={workspace} state={state} api={api} viewer={viewer} busy={busy} anchor={anchor}
      onClose={(message) => { setOpen(null); if (typeof message === 'string' && message) notice(message); }}
      onSaved={(saved) => notice(`Saved “${saved?.name || 'the program'}”.${saved?.schedule?.enabled && saved.schedule.nextRunAt ? ` Next run ${scheduledDate(saved.schedule.nextRunAt, saved.schedule.timeZone)}.` : ''}`)}
      onStartResearch={canRun && !needsSetup ? onStartResearch : undefined}
      onOpenFullPage={onOpenProgramPage ? (id) => { setOpen(null); onOpenProgramPage(id); } : undefined} />}
  </section>;
}
