import React, { useRef, useState } from 'react';
import { ArrowRight, CalendarClock, Pencil, Plus, Radar } from 'lucide-react';
import { MoreMenu } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { can as canCall, hasCapability, useViewer, writeProps } from './viewer.js';
import { number } from './ui.jsx';
import { CODEX_UNCAPPED } from './studio-actions.js';
import { programSummaries, scheduledDate } from './program-summary.js';
import { ProgramDrawer } from './program-drawer.jsx';
import './home-programs.css';

// Home → Research programs (admins with Manage research programs): each program's schedule, next and last run, sources
// and budgets, with Run now (the layout's own confirmation shows the estimate first), Edit (the quick-edit drawer with
// every setting) and Pause or Resume schedule (Resume confirms the per-run caps). Add program opens the same drawer empty. Money shows only with See costs.
const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '—');
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const day = (value) => { const date = new Date(value || 0); return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };

function statusChip(row) {
  if (row.activeRun?.status === 'awaiting-review') return { tone: 'review', label: 'Needs your OK' };
  if (row.activeRun) return { tone: 'active', label: 'Running' };
  if (row.schedule.problem) return { tone: 'problem', label: 'Schedule paused' };
  if (row.lastRun?.status === 'failed') return { tone: 'problem', label: 'Stopped' };
  return null;
}

export function ProgramsPanel({ state = {}, viewer: viewerIn, api = {}, busy = false, needsSetup = false, onStartResearch, onOpenTarget, onNotice, onOpenProgramPage, limit = 5 }) {
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

  const shown = rows.slice(0, limit);
  const editing = open === 'new' ? null : programs.find((program) => program.id === open) || null;
  return <section className="wb-card hp-card" aria-labelledby="hp-title" data-spot="home.programs" ref={anchor}>
    <header className="wb-card-head"><span className="wb-icon tone-purple" aria-hidden="true"><Radar size={17} /></span><h2 id="hp-title"><span className="wb-title-text">Research programs</span> <span className="wb-count">{number(rows.length)}</span></h2>
      <button type="button" className="wb-link" onClick={() => onOpenTarget?.({ kind: 'page', id: 'research', page: 'research' })}>All programs<ArrowRight size={14} aria-hidden="true" /></button>
    </header>
    {problem && <p className="wb-problem" role="alert">{problem}</p>}
    {shown.length ? <ul className="hp-list">{shown.map((row) => {
      const chip = statusChip(row);
      const codex = codexStudio || row.lastRun?.route === 'codex';
      const runTitle = needsSetup ? 'Connect Apify first' : !row.sources.total ? 'Add sources first' : undefined;
      const { byPlatform } = row.sources;
      return <li key={row.id} className="hp-row">
        <div className="hp-copy">
          <div className="hp-line">
            <button type="button" className="hp-name" onClick={() => setOpen(row.id)}>{row.name}</button>
            {chip && (chip.tone === 'review' && onOpenTarget
              ? <button type="button" className={`hp-chip tone-${chip.tone}`} onClick={() => onOpenTarget({ kind: 'run', id: row.activeRun.id, page: 'research' })}>{chip.label}</button>
              : <span className={`hp-chip tone-${chip.tone}`}>{chip.label}</span>)}
          </div>
          <p className="hp-meta"><CalendarClock size={13} aria-hidden="true" />{row.schedule.summary} · {row.schedule.recurring ? (row.schedule.enabled ? 'Schedule on' : 'Paused') : 'On demand'}</p>
          <p className="hp-meta">Next: {row.schedule.next || '—'} · {row.lastRun ? `Last: ${day(row.lastRun.at)} · ${readable(row.lastRun.status)}` : 'No runs yet'}</p>
          <ul className="hp-chips" aria-label={`Sources for ${row.name}`}>
            {byPlatform.x > 0 && <li>X {number(byPlatform.x)}</li>}
            {byPlatform.reddit > 0 && <li>Reddit {number(byPlatform.reddit)}</li>}
            {byPlatform.linkedin > 0 && <li>LinkedIn {number(byPlatform.linkedin)}</li>}
            {row.sources.keywordSearch && <li>LinkedIn search</li>}
            {!row.sources.total && <li className="is-empty">No sources yet</li>}
          </ul>
          {seeCosts && <p className="hp-meta hp-money">{money(row.budgets.collectionUsd)} collection + {money(row.budgets.aiUsd)} AI per run{row.lastRun && (codex ? ' · AI spend isn’t reported on Codex' : row.lastRun.costUsd !== null ? ` · last run ${money(row.lastRun.costUsd)}` : '')}</p>}
          {row.schedule.problem && <p className="hp-problem">Schedule paused: {row.schedule.problem}</p>}
          {!row.schedule.problem && row.schedule.skipped && <p className="hp-meta">{row.schedule.skipped}</p>}
        </div>
        <div className="hp-actions">
          {canRun && <button type="button" className="wb-primary" aria-label={`Run “${row.name}” now`} title={runTitle} {...writeProps(viewer, busy || needsSetup || !row.sources.total || Boolean(working))} onClick={() => onStartResearch(row.program)}><Radar size={14} aria-hidden="true" />Run now</button>}
          <button type="button" className="wb-quiet" aria-label={`Edit “${row.name}”`} onClick={() => setOpen(row.id)}><Pencil size={14} aria-hidden="true" />Edit</button>
          <MoreMenu label={`More for ${row.name}`} disabled={Boolean(working)} items={[
            row.schedule.recurring && !viewer.preview && { label: row.schedule.enabled ? 'Pause schedule' : 'Resume schedule', onSelect: () => saveSchedule(row, !row.schedule.enabled), disabled: busy },
            (onOpenProgramPage || onOpenTarget) && { label: 'Open in Research programs', onSelect: () => (onOpenProgramPage ? onOpenProgramPage(row.id) : onOpenTarget({ kind: 'page', id: 'research', page: 'research' })) },
          ]} />
        </div>
      </li>;
    })}</ul> : <p className="wb-empty">No research programs yet. A program is the accounts and communities research follows, with its schedule and budgets.</p>}
    <div className="hp-foot">
      <button type="button" className="wb-quiet" {...writeProps(viewer, busy || !workspace)} onClick={() => setOpen('new')}><Plus size={14} aria-hidden="true" />Add program</button>
      {rows.length > limit && <button type="button" className="wb-link" onClick={() => onOpenTarget?.({ kind: 'page', id: 'research', page: 'research' })}>See all {number(rows.length)}<ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
    {open && workspace && <ProgramDrawer key={open} program={editing} missing={open !== 'new' && !editing} workspace={workspace} state={state} api={api} viewer={viewer} busy={busy} anchor={anchor}
      onClose={(message) => { setOpen(null); if (typeof message === 'string' && message) notice(message); }}
      onSaved={(saved) => notice(`Saved “${saved?.name || 'the program'}”.${saved?.schedule?.enabled && saved.schedule.nextRunAt ? ` Next run ${scheduledDate(saved.schedule.nextRunAt, saved.schedule.timeZone)}.` : ''}`)}
      onStartResearch={canRun && !needsSetup ? onStartResearch : undefined}
      onOpenFullPage={onOpenProgramPage ? (id) => { setOpen(null); onOpenProgramPage(id); } : undefined} />}
  </section>;
}
