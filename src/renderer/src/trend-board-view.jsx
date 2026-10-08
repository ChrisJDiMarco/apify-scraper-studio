import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FileText, LoaderCircle, Radar, RotateCcw, Sparkles, SquareKanban, Undo2, X } from 'lucide-react';
import { Button, formatDate, number, withViewTransition } from './ui.jsx';
import { PASSED_STAGE, TREND_STAGES, buildTrendBoard, generationPlan } from '../../shared/trend-board.js';
import './trend-board.css';

const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : '—');
const PLATFORMS = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
const NOVELTY = { 'NEW TOPIC': 'New topic', 'NEW ANGLE': 'New angle', EVERGREEN: 'Evergreen' };
const DROP_DECISION = { potential: 'pending', approved: 'approved', passed: 'passed' };
// A stable view-transition name lets a card glide to its new column instead of popping.
const transitionName = (key) => `trend-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const splitKey = (key) => { const at = key.indexOf(':'); return [key.slice(0, at), key.slice(at + 1)]; };
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;

function scoutingText(scout) {
  if (scout.status === 'failed') return scout.error || 'Scouting stopped before any trends were found.';
  if (scout.stage === 'discovery' && scout.progress) return `Finding trends · batch ${number(scout.progress.completed)} of ${number(scout.progress.total)}`;
  if (scout.status === 'queued') return 'Starting soon';
  return 'Collecting posts and conversations';
}

function TrendCard({ card, disabled, dragging, onDecide, onDragStart, onDragEnd, onOpenRun, onReadReport, onCreateAssets }) {
  const report = card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0];
  return <article className={`tb-card ${card.needsAttention ? 'attention' : ''} ${dragging ? 'dragging' : ''}`} style={{ viewTransitionName: transitionName(card.key) }} draggable={card.canDecide && !disabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card.key); onDragStart(card.key); }} onDragEnd={onDragEnd} aria-label={card.name}>
    {(card.priorityTier || card.novelty) && <div className="tb-card-meta">{card.priorityTier && <span className={`tb-tier tier-${card.priorityTier.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={card.priorityScore != null ? `Priority score ${card.priorityScore}` : undefined}>{card.priorityTier}</span>}{card.novelty && <span className="tb-tag">{NOVELTY[card.novelty] || card.novelty}</span>}</div>}
    <h4>{card.name}</h4>
    {card.description && <p className="tb-card-description">{card.description}</p>}
    <div className="tb-card-facts"><span>{plural(card.evidenceCount, 'source')}</span>{card.velocity && <span>{card.velocity === 'NEW' ? 'New' : card.velocity === 'EMERGING' ? 'Seen twice' : `Seen in ${card.detectionCount} runs`}</span>}{card.category && <span>{card.category}</span>}{card.platforms.map((platform) => <span key={platform}>{PLATFORMS[platform] || platform}</span>)}{card.discoveredAt && <span>{formatDate(card.discoveredAt)}</span>}{card.programName && <span className="tb-card-program" title={card.programName}>{card.programName}</span>}</div>
    {card.stage === 'potential' && <div className="tb-card-actions"><Button type="button" className="tb-ok" disabled={disabled} onClick={() => onDecide(card, 'approved')}><Check size={14} aria-hidden="true" />Approve</Button><Button type="button" className="cs-quiet" disabled={disabled} onClick={() => onDecide(card, 'passed')}><X size={14} aria-hidden="true" />Pass</Button></div>}
    {card.stage === 'approved' && card.canDecide && <div className="tb-card-actions"><span className="tb-state"><Check size={13} aria-hidden="true" />Approved</span><Button type="button" className="cs-quiet" disabled={disabled} onClick={() => onDecide(card, 'pending')}><Undo2 size={13} aria-hidden="true" />Undo</Button></div>}
    {card.stage === 'production' && <div className="tb-card-actions"><span className={`tb-state ${card.needsAttention ? 'attention' : ''}`}>{card.needsAttention ? <CircleAlert size={13} aria-hidden="true" /> : <LoaderCircle size={13} className="spin" aria-hidden="true" />}{card.activity}</span>{card.needsAttention && <Button type="button" className="cs-quiet" onClick={() => onOpenRun(card.runId)}>Open run<ArrowRight size={13} aria-hidden="true" /></Button>}</div>}
    {card.stage === 'ready' && <div className="tb-card-actions">{report && <Button type="button" className="cs-quiet" onClick={() => onReadReport(report)}><FileText size={13} aria-hidden="true" />Read report</Button>}{report && <Button type="button" className="tb-ok" disabled={disabled} onClick={() => onCreateAssets(report)}><Sparkles size={13} aria-hidden="true" />{card.contentRunCount ? 'Create more' : 'Create assets'}</Button>}{card.assetCount > 0 && <small className="tb-asset-count">{plural(card.assetCount, 'asset')} made</small>}</div>}
    {card.stage === 'passed' && card.canDecide && <div className="tb-card-actions"><Button type="button" className="cs-quiet" disabled={disabled} onClick={() => onDecide(card, 'pending')}><RotateCcw size={13} aria-hidden="true" />Reconsider</Button></div>}
  </article>;
}

export function TrendBoardView({ studio = {}, monday, api, action, disabled, pageHeading = false, onFindTrends, onOpenRun, onOpenSheets, onReadReport, onCreateAssets, onSettings }) {
  const [pending, setPending] = useState({}); // optimistic decisions so a card moves the instant it is decided
  const [boardError, setBoardError] = useState('');
  const [confirmRunId, setConfirmRunId] = useState('');
  const [showPassed, setShowPassed] = useState(false);
  const [dragKey, setDragKey] = useState('');
  const [dropStage, setDropStage] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const researchRuns = useMemo(() => list(studio.researchRuns).map((run) => {
    const own = Object.entries(pending).filter(([key]) => splitKey(key)[0] === run.id);
    if (!own.length || run.status !== 'awaiting-review') return run;
    const decisions = { ...(run.decisions || {}) };
    for (const [key, decision] of own) { const themeId = splitKey(key)[1]; if (decision === 'pending') delete decisions[themeId]; else decisions[themeId] = decision; }
    return { ...run, decisions };
  }), [studio.researchRuns, pending]);
  const board = useMemo(() => buildTrendBoard({ researchRuns, contentRuns: studio.contentRuns, assets: studio.assets, programs: studio.programs }), [researchRuns, studio.contentRuns, studio.assets, studio.programs]);
  // Forget an optimistic decision once the saved state agrees with it.
  useEffect(() => {
    setPending((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key, decision]) => { const [runId, themeId] = splitKey(key); const run = list(studio.researchRuns).find((row) => row.id === runId); return run && run.status === 'awaiting-review' && (run.decisions?.[themeId] || 'pending') !== decision; }));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [studio.researchRuns]);

  function decide(card, decision) {
    if (!card?.canDecide || card.decision === decision) return;
    setBoardError('');
    withViewTransition(() => setPending((current) => ({ ...current, [card.key]: decision })), ['trend-move']);
    Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision })).catch((error) => {
      withViewTransition(() => setPending((current) => { const next = { ...current }; delete next[card.key]; return next; }), ['trend-move']);
      setBoardError(error?.message || 'That decision could not be saved. Try again.');
    });
  }
  async function generate(runId) {
    const { approved } = generationPlan(board.cards, runId);
    setConfirmRunId('');
    await action('Starting reports', async () => {
      await api.approveResearchThemes({ runId, themes: approved.map((card) => card.themeId) });
      return api.continueResearchRun({ runId });
    }, `Writing reports for ${plural(approved.length, 'trend')}. Cards move to Ready as each one finishes.`);
  }
  async function syncMonday() {
    setSyncNote('');
    const cards = board.cards.map(({ key, stage, name, description, evidenceCount, platforms, programName }) => ({ key, stage, name, description, evidenceCount, platforms, programName }));
    if (!window.confirm(`Send ${plural(cards.length, 'trend')} to your Monday.com board? Existing items are updated, new ones are added.`)) return;
    const result = await action('Syncing to Monday.com', () => api.syncTrendBoardToMonday({ cards }));
    if (result) setSyncNote(result.failed ? `${number(result.created + result.updated)} synced, ${number(result.failed)} failed. ${result.error}` : `${plural(result.created, 'new item')} and ${plural(result.updated, 'update')} sent to Monday.com.`);
  }
  function drop(stage) {
    const card = board.cards.find((row) => row.key === dragKey);
    setDragKey(''); setDropStage('');
    if (card && stage in DROP_DECISION) decide(card, DROP_DECISION[stage]);
  }
  const dragCard = board.cards.find((row) => row.key === dragKey);
  const approvedRuns = [...new Set(board.columns.approved.filter((card) => card.canDecide).map((card) => card.runId))];
  const runById = new Map(list(studio.researchRuns).map((run) => [run.id, run]));
  const Heading = pageHeading ? 'h1' : 'h2';
  const empty = !board.cards.length && !board.scouting.length;
  const stages = showPassed ? [...TREND_STAGES, PASSED_STAGE] : TREND_STAGES;

  const mondayControl = !api.syncTrendBoardToMonday ? null
    : !monday?.connected ? <Button type="button" className="cs-quiet" onClick={onSettings}><SquareKanban size={14} aria-hidden="true" />Connect Monday.com</Button>
    : !monday.boardId ? <Button type="button" className="cs-quiet" onClick={onSettings}><SquareKanban size={14} aria-hidden="true" />Choose a Monday board</Button>
    : <Button type="button" className="cs-quiet" disabled={disabled || !board.cards.length} onClick={syncMonday} title={monday.lastSyncedAt ? `Last synced ${formatDate(monday.lastSyncedAt)}` : 'Not synced yet'}><SquareKanban size={14} aria-hidden="true" />Sync to {monday.boardName || 'Monday.com'}</Button>;

  return <div className="tb-board">
    <div className={`cs-section-heading ${pageHeading ? 'cs-page-heading' : ''}`}>
      <div><Heading>Trend board</Heading><p>Research scouts the trends. You decide which ones become reports and campaigns.</p></div>
      <div className="tb-head-actions">{mondayControl}<Button type="button" disabled={disabled} onClick={onFindTrends}><Radar size={15} aria-hidden="true" />Find new trends</Button></div>
    </div>
    {(boardError || syncNote || monday?.lastError) && <p className={`tb-note ${boardError || monday?.lastError ? 'attention' : ''}`} role={boardError ? 'alert' : 'status'}>{boardError || syncNote || `Last Monday.com sync: ${monday.lastError}`}</p>}
    {empty ? <div className="cs-empty"><span><Radar size={24} aria-hidden="true" /></span><h3>No trends on the board yet</h3><p>Run a research program. Every trend it finds lands in Potential trends for your OK, and nothing is written or spent until you approve it.</p><Button type="button" onClick={onFindTrends}>Set up research<ArrowRight size={14} aria-hidden="true" /></Button></div>
      : <div className="tb-columns" style={{ '--tb-columns': stages.length }}>
        {stages.map((stage) => {
          const cards = board.columns[stage.id];
          const droppable = Boolean(dragCard) && stage.id in DROP_DECISION && dragCard.stage !== stage.id;
          return <section key={stage.id} className={`tb-column tb-${stage.id} ${droppable ? 'droppable' : ''} ${droppable && dropStage === stage.id ? 'over' : ''}`} aria-labelledby={`tb-col-${stage.id}`}
            onDragOver={(event) => { if (!droppable) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (dropStage !== stage.id) setDropStage(stage.id); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropStage(''); }}
            onDrop={(event) => { event.preventDefault(); if (droppable) drop(stage.id); }}>
            <header><h3 id={`tb-col-${stage.id}`}>{stage.label}</h3><span className="tb-count">{number(cards.length)}</span><p>{stage.hint}</p></header>
            <div className="tb-stack">
              {stage.id === 'potential' && board.scouting.map((scout) => <div key={scout.runId} className={`tb-scout ${scout.status === 'failed' ? 'attention' : ''}`} role="status"><span className="local-dot" data-live={scout.status === 'failed' ? undefined : ''} aria-hidden="true" /><div><strong>{scout.title}</strong><small>{scoutingText(scout)}</small></div>{onOpenSheets && (studio.researchRuns || []).find((run) => run.id === scout.runId)?.counts?.retained > 0 && <Button type="button" className="cs-quiet" onClick={() => onOpenSheets(scout.runId)}>View posts</Button>}{scout.status === 'failed' && <Button type="button" className="cs-quiet" onClick={() => onOpenRun(scout.runId)}>Open run</Button>}</div>)}
              {stage.id === 'approved' && approvedRuns.map((runId) => {
                const plan = generationPlan(board.cards, runId); const run = runById.get(runId); const confirming = confirmRunId === runId;
                return <div key={runId} className={`tb-batch ${confirming ? 'confirming' : ''}`}>
                  <div><strong>{plan.approved[0]?.programName}</strong><small>{plural(plan.approved.length, 'approved trend')}{plan.undecided.length ? ` · ${number(plan.undecided.length)} still in Potential` : ''}</small></div>
                  {confirming ? <><p>Writes an evidence report and editorial toolkit for each approved trend, using up to {money(run?.maxBudgetUsd)} of this run’s AI budget.{plan.undecided.length ? ` ${plural(plan.undecided.length, 'undecided trend')} will be passed.` : ''}</p><div className="tb-card-actions"><Button type="button" className="tb-ok" disabled={disabled} onClick={() => generate(runId)}><Sparkles size={13} aria-hidden="true" />Generate reports</Button><Button type="button" className="cs-quiet" onClick={() => setConfirmRunId('')}>Not yet</Button></div></>
                    : <Button type="button" className="tb-ok" disabled={disabled} onClick={() => setConfirmRunId(runId)}><Sparkles size={13} aria-hidden="true" />Generate reports</Button>}
                </div>;
              })}
              {cards.map((card) => <TrendCard key={card.key} card={card} disabled={disabled} dragging={dragKey === card.key} onDecide={decide} onDragStart={setDragKey} onDragEnd={() => { setDragKey(''); setDropStage(''); }} onOpenRun={onOpenRun} onReadReport={onReadReport} onCreateAssets={onCreateAssets} />)}
              {!cards.length && !(stage.id === 'potential' && board.scouting.length) && !(stage.id === 'approved' && approvedRuns.length) && <p className="tb-column-empty">{droppable ? 'Drop here' : stage.id === 'potential' ? 'New trends from research land here.' : stage.id === 'approved' ? 'OK a trend to move it here.' : stage.id === 'production' ? 'Nothing generating right now.' : stage.id === 'ready' ? 'Finished reports appear here.' : 'Passed trends stay here in case you change your mind.'}</p>}
            </div>
          </section>;
        })}
      </div>}
    {!empty && board.columns.passed.length > 0 && <Button type="button" className="cs-quiet tb-passed-toggle" aria-expanded={showPassed} onClick={() => withViewTransition(() => setShowPassed((open) => !open), ['trend-move'])}>{showPassed ? 'Hide passed trends' : `Show ${plural(board.columns.passed.length, 'passed trend')}`}</Button>}
  </div>;
}
