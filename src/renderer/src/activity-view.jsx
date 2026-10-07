import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock3, Database, FileText, Globe2, Hourglass, LoaderCircle, RotateCcw, Search, Sparkles, Square, SquareKanban } from 'lucide-react';
import { ACTIVITY_KINDS, activitySummary, buildActivity, dayLabel, filterActivity, formatDuration } from '../../shared/activity-feed.js';
import { Button, JsonBlock, formatDate, label, number } from './ui.jsx';
import './workspace-pages.css';

const KIND_ICONS = { collection: Globe2, research: Search, content: FileText, analysis: Sparkles, job: CircleDashed };
const STATE_LABEL = { active: 'Running', review: 'Waiting on you', attention: 'Needs attention', done: 'Done', idle: 'Idle' };
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value < 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value || 0);

function StateIcon({ state }) {
  if (state === 'active') return <LoaderCircle size={16} className="spin" aria-hidden="true" />;
  if (state === 'review') return <Hourglass size={16} aria-hidden="true" />;
  if (state === 'attention') return <AlertTriangle size={16} aria-hidden="true" />;
  if (state === 'done') return <CheckCircle2 size={16} aria-hidden="true" />;
  return <CircleDashed size={16} aria-hidden="true" />;
}

// Re-render once a second only while something is running, so live durations tick without idle cost.
function useTicker(active) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (!document.hidden) setTick((value) => value + 1); }, 1000);
    return () => clearInterval(timer);
  }, [active]);
}

export function ActivityView({ state, busy, onRunRecipe, onDatasetSelect, onNavigate, onOpenStudio, onCancelJob }) {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [sinceDays, setSinceDays] = useState(30);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const listRef = useRef(null);
  const entries = useMemo(() => buildActivity(state), [state]);
  const summary = useMemo(() => activitySummary(entries), [entries]);
  const visible = filterActivity(entries, { kind, state: status, query, sinceDays });
  const selected = visible.find((entry) => entry.id === selectedId) || visible[0] || null;
  useTicker(summary.active > 0);
  const groups = [];
  for (const entry of visible) { const day = dayLabel(entry.startedAt); if (groups.at(-1)?.day !== day) groups.push({ day, entries: [] }); groups.at(-1).entries.push(entry); }
  const kindCounts = Object.fromEntries(ACTIVITY_KINDS.map((item) => [item.id, entries.filter((entry) => entry.kind === item.id).length]));

  function moveSelection(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const index = visible.findIndex((entry) => entry.id === selected?.id);
    const next = visible[Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setSelectedId(next.id);
    listRef.current?.querySelector(`[data-entry="${CSS.escape(next.id)}"]`)?.focus();
  }
  const liveDuration = (entry) => entry.state === 'active' && entry.startedAt ? formatDuration(Date.now() - Date.parse(entry.startedAt)) : formatDuration(entry.durationMs);

  return <section className="ws ws-activity">
    <header className="ws-page-head">
      <div><span className="ws-eyebrow">Everything your workspace did</span><h2>Activity</h2><p>Collections, research, content, and AI analysis in one timeline. Open anything to see what happened and what to do next.</p></div>
      <div className="ws-head-actions"><Button className="ghost" onClick={() => onNavigate('automation')}><Globe2 size={15} aria-hidden="true" />New collection</Button></div>
    </header>
    <div className="ws-stat-row">
      <button type="button" className="ws-stat" aria-pressed={status === 'active'} onClick={() => setStatus((value) => value === 'active' ? 'all' : 'active')}><span>Running now</span><strong>{number(summary.active)}</strong>{summary.active > 0 && <small className="ws-live"><i aria-hidden="true" />Live</small>}</button>
      <button type="button" className="ws-stat" aria-pressed={status === 'review'} onClick={() => setStatus((value) => value === 'review' ? 'all' : 'review')}><span>Waiting on you</span><strong>{number(summary.review)}</strong>{summary.review > 0 && <small>Trends to review</small>}</button>
      <button type="button" className="ws-stat" aria-pressed={status === 'attention'} onClick={() => setStatus((value) => value === 'attention' ? 'all' : 'attention')}><span>Needs attention</span><strong className={summary.attention ? 'warn' : ''}>{number(summary.attention)}</strong><small>Last 7 days</small></button>
      <div className="ws-stat"><span>Finished this week</span><strong>{number(summary.doneThisWeek)}</strong><small>{number(summary.rowsThisWeek)} rows collected</small></div>
      <div className="ws-stat"><span>AI spend this week</span><strong>{money(summary.spendThisWeek)}</strong><small>Recorded by runs</small></div>
    </div>
    <div className="ws-toolbar">
      <label className="ws-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, errors, statuses…" /></label>
      <div className="ws-segmented" role="group" aria-label="Kind"><button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All <span>{number(entries.length)}</span></button>{ACTIVITY_KINDS.filter((item) => kindCounts[item.id]).map((item) => <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label} <span>{number(kindCounts[item.id])}</span></button>)}</div>
      <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Any status</option>{Object.entries(STATE_LABEL).filter(([key]) => key !== 'idle').map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
      <select aria-label="Time range" value={sinceDays} onChange={(event) => setSinceDays(Number(event.target.value))}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={0}>All time</option></select>
    </div>
    {!entries.length ? <div className="ws-empty"><Clock3 size={22} aria-hidden="true" /><h3>Nothing has run yet</h3><p>Start a collection or a research program. Every run, report, and generation shows up here with its outcome.</p><Button onClick={() => onNavigate('automation')}>Start a collection<ArrowRight size={14} aria-hidden="true" /></Button></div>
      : <div className="ws-split">
        <div className="ws-timeline" ref={listRef} onKeyDown={moveSelection} aria-label="Activity timeline">
          {groups.map((group) => <div key={group.day} className="ws-day"><h3>{group.day}</h3><ul>{group.entries.map((entry) => { const Icon = KIND_ICONS[entry.kind] || CircleDashed; return <li key={entry.id}>
            <button type="button" data-entry={entry.id} className={`ws-entry ${entry.state} ${selected?.id === entry.id ? 'selected' : ''}`} aria-current={selected?.id === entry.id ? 'true' : undefined} onClick={() => setSelectedId(entry.id)}>
              <span className={`ws-state ${entry.state}`} title={STATE_LABEL[entry.state]}><StateIcon state={entry.state} /><span className="sr-only">{STATE_LABEL[entry.state]}</span></span>
              <span className="ws-entry-main"><strong>{entry.title}</strong><small><Icon size={12} aria-hidden="true" />{ACTIVITY_KINDS.find((item) => item.id === entry.kind)?.label}{entry.subtitle ? ` · ${entry.subtitle}` : ''}</small>{entry.error && <small className="ws-entry-error">{entry.error}</small>}</span>
              <span className="ws-entry-meta">{entry.itemCount > 0 && <span>{number(entry.itemCount)} rows</span>}{liveDuration(entry) && <span>{liveDuration(entry)}</span>}<time dateTime={entry.startedAt}>{entry.startedAt ? new Date(entry.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</time></span>
            </button></li>; })}</ul></div>)}
          {!visible.length && <div className="ws-empty"><Search size={22} aria-hidden="true" /><h3>Nothing matches</h3><p>Widen the time range or clear the filters.</p><Button className="ghost" onClick={() => { setKind('all'); setStatus('all'); setQuery(''); setSinceDays(0); }}>Show everything</Button></div>}
        </div>
        {selected && <aside className="ws-detail" aria-label="Activity details">
          <div className="ws-detail-head"><span className={`ws-state ${selected.state}`}><StateIcon state={selected.state} /></span><div><span className="ws-eyebrow">{ACTIVITY_KINDS.find((item) => item.id === selected.kind)?.label}</span><h3>{selected.title}</h3><p>{STATE_LABEL[selected.state]} · {label(selected.status)}</p></div></div>
          {selected.error && <div className="ws-callout attention"><AlertTriangle size={15} aria-hidden="true" /><span>{selected.error}</span></div>}
          <dl className="ws-facts">
            <div><dt>Started</dt><dd>{selected.startedAt ? formatDate(selected.startedAt) : '—'}</dd></div>
            <div><dt>{selected.state === 'active' ? 'Running for' : 'Took'}</dt><dd>{liveDuration(selected) || '—'}</dd></div>
            {selected.itemCount != null && <div><dt>Rows</dt><dd>{number(selected.itemCount)}</dd></div>}
            {Number(selected.costUsd) > 0 && <div><dt>Recorded cost</dt><dd>{money(Number(selected.costUsd))}</dd></div>}
            {selected.subtitle && <div className="wide"><dt>Details</dt><dd>{selected.subtitle}</dd></div>}
          </dl>
          <div className="ws-detail-actions">
            {selected.kind === 'collection' && selected.recipeId && <Button disabled={busy} onClick={() => onRunRecipe(selected.recipeId)}><RotateCcw size={14} aria-hidden="true" />Run again</Button>}
            {selected.datasetId && <Button className="ghost" onClick={() => { onDatasetSelect(selected.datasetId); onNavigate('datasets'); }}><Database size={14} aria-hidden="true" />Open dataset</Button>}
            {selected.kind === 'research' && selected.state === 'review' && <Button onClick={() => onOpenStudio('board')}><SquareKanban size={14} aria-hidden="true" />Review trends</Button>}
            {selected.kind === 'research' && selected.state !== 'review' && <Button className="ghost" onClick={() => onOpenStudio('research')}>Open in Research programs<ArrowRight size={14} aria-hidden="true" /></Button>}
            {selected.kind === 'content' && <Button className="ghost" onClick={() => onOpenStudio('create')}>Open in Create content<ArrowRight size={14} aria-hidden="true" /></Button>}
            {selected.kind === 'analysis' && <Button className="ghost" onClick={() => onNavigate('reports', { analysisId: selected.analysisId })}>Open report<ArrowRight size={14} aria-hidden="true" /></Button>}
            {selected.kind === 'job' && selected.cancellable && selected.state === 'active' && <Button className="ghost danger" disabled={busy} onClick={() => onCancelJob(selected.jobId)}><Square size={12} aria-hidden="true" />Cancel</Button>}
          </div>
          <details className="ws-tech"><summary>Technical details</summary><JsonBlock value={selected.raw} /></details>
        </aside>}
      </div>}
  </section>;
}
