// Trends' filter bar and its Board. The bar narrows both layouts (trend-filters.js). The Board is one column per stage,
// each cut short with "Show more" and scrolling on its own, so hundreds of trends never make one endless page. A card
// moves between columns by dragging or from its "Move to" menu; both go through movePlan, which says what the move does,
// asks first when it goes backwards or files a trend away, and explains a move that can't be made instead of ignoring it.
import React, { useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowRight, CalendarDays, LoaderCircle, MoveRight, RotateCcw, Search, Undo2, X } from 'lucide-react';
import { MoreMenu } from './role-screens.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { readJsonChoice, saveJsonChoice } from './choices.js';
import { writeProps } from './viewer.js';
import { number } from './ui.jsx';
import { ARCHIVED_STAGE, PASSED_STAGE, TREND_STAGES } from '../../shared/trend-board.js';
import { NO_FILTERS, PAGE, PLATFORM_LABELS, SINCE_OPTIONS, SORT_OPTIONS, TIER_LABELS, activeCount, askAgain, foundOn, movePlan, stopAsking } from './trend-filters.js';

const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
export const BOARD_STAGES = [...TREND_STAGES, PASSED_STAGE, ARCHIVED_STAGE];
const SILENCED = 'trends.dont-ask';

// Runs a move: refuses with the reason, or asks (unless that question was silenced), then does it.
// handlers: { onDecide(card, decision), onWriteReports({ runId }), onArchive(card, archived) }; onRefuse(reason).
export function useTrendMove({ viewer, can, handlers, onRefuse }) {
  const confirm = useConfirm();
  return async function move(card, toStage) {
    const plan = movePlan(card, toStage, { can });
    if (!plan.allowed) { if (plan.reason) onRefuse?.(plan.reason); return false; }
    if (plan.confirm) {
      const silenced = readJsonChoice(viewer, SILENCED, { ids: [] })?.ids;
      if (askAgain(silenced, plan.confirm.id)) {
        const ok = await confirm({ ...plan.confirm, remember: 'Don’t ask me this again', onRemember: () => saveJsonChoice(viewer, SILENCED, { ids: stopAsking(readJsonChoice(viewer, SILENCED, { ids: [] })?.ids, plan.confirm.id) }) });
        if (!ok) return false;
      }
    }
    onRefuse?.('');
    const { action } = plan;
    if (action.kind === 'decide') return handlers.onDecide?.(card, action.decision);
    if (action.kind === 'write-reports') return handlers.onWriteReports?.({ runId: action.runId });
    return handlers.onArchive?.(card, action.archived);
  };
}

// filters ({ query, tier, platform, since, sort }) and onChange(next); choices ({ tiers, platforms }) are what the trends
// on the page have; shown and total are how many trends match and how many there are.
export function TrendsToolbar({ filters, onChange, choices = { tiers: [], platforms: [] }, shown = 0, total = 0 }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  const narrowed = activeCount(filters);
  return <div className="trend-tools" role="search" aria-label="Filter trends" data-spot="trends.filters">
    <label className="simple-search trend-tools-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search trends" placeholder="Search trends" value={filters.query} onChange={set('query')} />{filters.query && <button type="button" aria-label="Clear search" onClick={() => onChange({ ...filters, query: '' })}><X size={13} aria-hidden="true" /></button>}</label>
    {choices.tiers.length > 1 && <select className="trend-tools-pick" aria-label="Strength" value={filters.tier} data-on={filters.tier ? '' : undefined} onChange={set('tier')}><option value="">Any strength</option>{choices.tiers.map((id) => <option key={id} value={id}>{TIER_LABELS[id]}</option>)}</select>}
    {choices.platforms.length > 1 && <select className="trend-tools-pick" aria-label="Platform" value={filters.platform} data-on={filters.platform ? '' : undefined} onChange={set('platform')}><option value="">Any platform</option>{choices.platforms.map((id) => <option key={id} value={id}>{PLATFORM_LABELS[id]}</option>)}</select>}
    <select className="trend-tools-pick" aria-label="Found" value={filters.since} data-on={filters.since ? '' : undefined} onChange={set('since')}>{SINCE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{id ? `Found: ${label.toLowerCase()}` : 'Found any time'}</option>)}</select>
    <select className="trend-tools-pick" aria-label="Sort" value={filters.sort} onChange={set('sort')}>{SORT_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    <p className="trend-tools-count" role="status">{narrowed ? `${number(shown)} of ${plural(total, 'trend')}` : plural(total, 'trend')}{narrowed > 0 && <button type="button" className="simple-link" onClick={() => onChange({ ...NO_FILTERS, sort: filters.sort })}>Clear filters</button>}</p>
  </div>;
}

// "Show 8 more" under a list that was cut short. `left` is how many are hidden.
export function ShowMore({ left, onMore, what = 'trend' }) {
  if (left <= 0) return null;
  return <button type="button" className="simple-quiet trend-more" onClick={onMore}>Show {number(Math.min(left, PAGE * 2))} more<small>{plural(left, what)} not shown</small></button>;
}

export function TrendKanban({ board, approved, busy, canDecide, canWrite, viewer, can, meta, why, decided, yes, onDecide, onWriteReports, onArchive, onOpenReport, onOpenTrend, onOpenClassic }) {
  const [limits, setLimits] = useState({});
  const [note, setNote] = useState('');
  const [over, setOver] = useState('');
  const dragging = useRef(null);
  const [dragKey, setDragKey] = useState('');
  const move = useTrendMove({ viewer, can, handlers: { onDecide, onWriteReports, onArchive }, onRefuse: setNote });
  const locked = Boolean(viewer?.preview) || busy;
  const reportOf = (card) => card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0];
  const planFor = (card, stage) => movePlan(card, stage, { can });
  const endDrag = () => { dragging.current = null; setDragKey(''); setOver(''); };
  const drop = (stage) => (event) => { event.preventDefault(); const card = dragging.current; endDrag(); if (card && card.stage !== stage) move(card, stage); };
  return <>
    {note && <p className="trend-move-note" role="status"><span>{note}</span><button type="button" aria-label="Dismiss" onClick={() => setNote('')}><X size={14} aria-hidden="true" /></button></p>}
    <div className={`simple-kanban${dragKey ? ' is-dragging' : ''}`} data-spot="trends.kanban" role="list" aria-label="Trend board">
      {BOARD_STAGES.map((stage) => {
        const cards = board.columns[stage.id] || []; const limit = limits[stage.id] || PAGE; const shown = cards.slice(0, limit);
        const target = dragging.current && dragging.current.stage !== stage.id ? planFor(dragging.current, stage.id) : null;
        return <section key={stage.id} role="listitem" className={`simple-kanban-col stage-${stage.id}${over === stage.id && target ? (target.allowed ? ' drop-ok' : ' drop-no') : ''}`} aria-labelledby={`kanban-${stage.id}`}
          onDragOver={(event) => { if (!dragging.current) return; event.preventDefault(); /* Always a drop target: a browser never delivers a drop it was told to refuse, and a refused move has to say why. */ if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; if (over !== stage.id) setOver(stage.id); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && over === stage.id) setOver(''); }}
          onDrop={drop(stage.id)}>
          <header><h2 id={`kanban-${stage.id}`}>{stage.label}<span className="simple-kanban-count">{cards.length}</span></h2><p>{stage.hint}</p>
            {stage.id === 'approved' && canWrite && approved.length > 0 && <button type="button" data-spot="trends.write" className="simple-primary simple-kanban-action" {...writeProps(viewer, busy)} onClick={() => onWriteReports()}>Write reports<ArrowRight size={14} aria-hidden="true" /></button>}</header>
          <div className="simple-kanban-cards">
            {!cards.length && <p className="simple-kanban-empty">{stage.empty || 'Nothing here yet.'}</p>}
            {shown.map((card) => {
              const report = stage.id === 'ready' || stage.id === 'archived' ? reportOf(card) : null;
              const found = foundOn(card.discoveredAt);
              const moves = locked ? [] : BOARD_STAGES.filter((other) => other.id !== stage.id && planFor(card, other.id).allowed);
              return <article key={card.key} className={`simple-kanban-card${card.needsAttention ? ' attention' : ''}${dragKey === card.key ? ' is-dragged' : ''}`} data-spot="trends.card" data-spot-item={card.name}
                draggable={!locked && stage.id !== 'production'} onDragStart={(event) => { dragging.current = card; setDragKey(card.key); setNote(''); if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card.name); } }} onDragEnd={endDrag}
                style={{ viewTransitionName: `kanban-${card.key.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}>
                <div className="simple-kanban-top">{found ? <p className="simple-kanban-date" title={`Research found it ${found.full}`}><CalendarDays size={14} aria-hidden="true" /><span className="sr-only">Found </span><strong>{found.day}</strong>{found.ago && <small>{found.ago}</small>}</p> : <span className="simple-kanban-date" />}{moves.length > 0 && <MoreMenu label={`Move ${card.name}`} icon={MoveRight} buttonClassName="simple-kanban-move" items={moves.map((other) => ({ label: `Move to ${other.label}`, onSelect: () => move(card, other.id) }))} />}</div>
                {meta(card)}
                <h3>{onOpenTrend ? <button type="button" className="simple-trend-open" onClick={() => onOpenTrend(card)}>{card.name}</button> : card.name}</h3>
                {card.description && stage.id !== 'passed' && stage.id !== 'archived' && <p>{card.description}</p>}
                {stage.id === 'potential' ? why(card) : stage.id !== 'archived' && decided(card)}
                {stage.id === 'potential' && canDecide && card.canDecide && <div className="simple-kanban-buttons">{yes(card, 14)}<button type="button" data-spot="trends.skip" data-spot-item={card.name} className="simple-skip" aria-label={`Skip ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'passed')}>Skip</button></div>}
                {(stage.id === 'approved' || stage.id === 'passed') && canDecide && card.canDecide && <div className="simple-kanban-buttons"><button type="button" className="simple-skip" aria-label={`${stage.id === 'passed' ? 'Reconsider' : 'Undo the yes for'} ${card.name}`} {...writeProps(viewer, busy)} onClick={() => onDecide(card, 'pending')}>{stage.id === 'passed' ? <RotateCcw size={13} aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}{stage.id === 'passed' ? 'Reconsider' : 'Undo'}</button></div>}
                {stage.id === 'production' && <div className="simple-kanban-status">{card.needsAttention ? <X size={14} aria-hidden="true" /> : <LoaderCircle className="spin" size={14} aria-hidden="true" />}<span>{card.activity || 'Writing'}</span>{card.needsAttention && onOpenClassic && <button type="button" className="simple-link" onClick={() => onOpenClassic('research', card.runId ? { runId: card.runId } : {})}>See why</button>}</div>}
                {stage.id === 'ready' && <button type="button" className="simple-kanban-read" disabled={!report} onClick={() => report && onOpenReport(report.id)}>{plural(card.reportAssets?.length || 0, 'report')}<span>Read<ArrowRight size={13} aria-hidden="true" /></span></button>}
                {stage.id === 'archived' && <div className="simple-kanban-buttons">
                  {can('setTrendArchived') && <button type="button" className="simple-skip" aria-label={`Bring back ${card.name}`} {...writeProps(viewer, busy)} onClick={() => move(card, card.homeStage)}><ArchiveRestore size={13} aria-hidden="true" />Bring back</button>}
                  {report && <button type="button" className="simple-skip" aria-label={`${card.name}: read the report`} onClick={() => onOpenReport(report.id)}>Read</button>}
                </div>}
              </article>;
            })}
            <ShowMore left={cards.length - shown.length} onMore={() => setLimits((current) => ({ ...current, [stage.id]: limit + PAGE * 2 }))} />
          </div>
          {stage.id === 'archived' && !cards.length && dragKey && <p className="simple-kanban-drop"><Archive size={14} aria-hidden="true" />Drop here to archive</p>}
        </section>;
      })}
    </div>
  </>;
}
