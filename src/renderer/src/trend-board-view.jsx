import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FileText, Images, LoaderCircle, PenLine, Radar, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import { Button, formatDate, number, withViewTransition } from './ui.jsx';
import { PASSED_STAGE, TREND_STAGES, buildTrendBoard, generationPlan } from '../../shared/trend-board.js';
import { DecidedBy, Sparkline, WhyItMatters, decisionOf } from './trend-pulse.jsx';
import { TrendYesButton, channelLabel, fitsFor, routingChannels } from './trend-decision-sheet.jsx';
import { can as canCall, canRun, hasCapability, useViewer, writeProps } from './viewer.js';
import { useConfirm } from './confirm-dialog.jsx';
import { CODEX_UNCAPPED } from './studio-actions.js';
import { reportCostLine } from './cost-lines.js';
import { clearStudioDrag, markStudioDrag } from './ask-slash.js';
import { MondayChip, MondayStatusLine } from './monday-ui.jsx';
import './trend-board.css';

const list = (value) => (Array.isArray(value) ? value : []);
const PLATFORMS = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
const DROP_DECISION = { potential: 'pending', approved: 'approved', passed: 'passed' };
// A stable view-transition name lets a card glide to its new column instead of popping.
const transitionName = (key) => `trend-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const splitKey = (key) => { const at = key.indexOf(':'); return [key.slice(0, at), key.slice(at + 1)]; };
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const nameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function scoutingText(scout) {
  if (scout.status === 'failed') return scout.message || scout.error || 'It stopped before any trends were found.';
  if (scout.stage === 'discovery' && scout.progress) return `Finding trends · batch ${number(scout.progress.completed)} of ${number(scout.progress.total)}`;
  if (scout.status === 'queued') return 'Starting soon';
  return 'Collecting posts and conversations';
}

// `trend` is the trend history's record for this card (momentum and posts per run across research runs), or null; `by`
// is who decided it (run.decisionsBy), with their note and routed channels; `fits` names the person's own channels it
// fits (My channels).
function TrendCard({ card, trend = null, by = null, monday = null, channels = [], fits = [], disabled, mayDecide = false, write = { disabled: Boolean(disabled) }, preview = false, dragging, api, onDecide, onDecideWithNote, onAsk, onDragStart, onDragEnd, onOpenRun, onReadReport, onCreateAssets, onMakeAssets }) {
  const report = card.reportAssets?.find((asset) => asset.deliverableId === 'evidence-report') || card.reportAssets?.[0];
  return <article className={`tb-card ${card.needsAttention ? 'attention' : ''} ${dragging ? 'dragging' : ''}`} data-card-key={card.key} style={{ viewTransitionName: transitionName(card.key) }} draggable={mayDecide && card.canDecide && !disabled && !preview} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData('text/plain', card.key); markStudioDrag(event, { kind: 'trend', ref: card.name, id: card.key }); onDragStart(card.key); }} onDragEnd={() => { clearStudioDrag(); onDragEnd(); }} aria-label={card.name}>
    {card.priorityTier && <div className="tb-card-meta"><span className={`tb-tier tier-${card.priorityTier.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={card.priorityScore != null ? `Priority score ${card.priorityScore}` : undefined}>{card.priorityTier}</span></div>}
    <h4>{card.name}</h4>
    {card.description && <p className="tb-card-description">{card.description}</p>}
    {card.stage !== 'passed' && <WhyItMatters card={card} trend={trend} fits={fits} api={card.stage === 'potential' ? api : undefined} onAsk={card.stage === 'potential' ? onAsk : undefined} />}
    <div className="tb-card-facts"><span>{plural(card.evidenceCount, 'source')}</span>{list(trend?.spark).length > 1 && <span className="tb-card-spark"><Sparkline points={trend.spark} label={`Posts per research run for ${card.name}, oldest to newest: ${trend.spark.map((value) => number(value)).join(', ')}`} /></span>}{card.category && <span>{card.category}</span>}{card.platforms.map((platform) => <span key={platform}>{PLATFORMS[platform] || platform}</span>)}{card.discoveredAt && <span>{formatDate(card.discoveredAt)}</span>}{card.programName && <span className="tb-card-program" title={card.programName}>{card.programName}</span>}</div>
    {card.stage !== 'potential' && <DecidedBy by={by} decision={card.decision} channelName={(id) => channelLabel(channels, id)} />}
    {card.stage === 'potential' && mayDecide && <div className="tb-card-actions"><TrendYesButton card={card} channels={channels} className="tb-ok" size={14} ariaLabel={`Yes, use ${card.name}`} disabled={disabled} onDecide={onDecide} onDecideWithNote={onDecideWithNote} /><Button type="button" className="cs-quiet" aria-label={`Skip ${card.name}`} {...write} onClick={() => onDecide(card, 'passed')}><X size={14} aria-hidden="true" />Skip</Button></div>}
    {card.stage === 'approved' && card.canDecide && mayDecide && <div className="tb-card-actions">{!by && <span className="tb-state"><Check size={13} aria-hidden="true" />Approved</span>}<Button type="button" className="cs-quiet" {...write} onClick={() => onDecide(card, 'pending')}><Undo2 size={13} aria-hidden="true" />Undo</Button></div>}
    {card.stage === 'production' && <div className="tb-card-actions"><span className={`tb-state ${card.needsAttention ? 'attention' : ''}`}>{card.needsAttention ? <CircleAlert size={13} aria-hidden="true" /> : <LoaderCircle size={13} className="spin" aria-hidden="true" />}{card.activity}</span>{card.needsAttention && <Button type="button" className="cs-quiet" onClick={() => onOpenRun(card.runId)}>Open run<ArrowRight size={13} aria-hidden="true" /></Button>}</div>}
    {/* Ready: Make channel assets (the kit, over this page) leads; Create content (one-off drafts) stays a quiet extra. */}
    {card.stage === 'ready' && <div className="tb-card-actions">{report && <Button type="button" className="cs-quiet" onClick={() => onReadReport(report)}><FileText size={13} aria-hidden="true" />Read trends report</Button>}{report && onMakeAssets && <Button type="button" className="tb-ok" {...write} onClick={() => onMakeAssets(report)}><Images size={13} aria-hidden="true" />Make channel assets</Button>}{report && onCreateAssets && <Button type="button" className="cs-quiet" {...write} onClick={() => onCreateAssets(report)}><PenLine size={13} aria-hidden="true" />{card.contentRunCount ? 'Create more content' : 'Create content'}</Button>}{card.assetCount > 0 && <small className="tb-asset-count">{plural(card.assetCount, 'asset')} made</small>}</div>}
    {card.stage === 'passed' && card.canDecide && mayDecide && <div className="tb-card-actions"><Button type="button" className="cs-quiet" {...write} onClick={() => onDecide(card, 'pending')}><RotateCcw size={13} aria-hidden="true" />Reconsider</Button></div>}
    {monday?.items?.[card.key] && <div className="tb-card-monday"><MondayChip monday={monday} card={card} api={api} disabled={disabled} /></div>}
  </article>;
}

// `onAsk(question)` (optional) opens Ask AI for "What people are saying". Buttons whose callback is missing don't show:
// `onFindTrends` (a role that can start or set up research; `findLabel` says which it does), `onCreateAssets` (Create
// content), `onMakeAssets(report)` (the channel asset dialog); `askAdmin` names who to ask instead. `focus` ({ key,
// themeId }) is a trend opened from elsewhere (Home's Needs your OK, What changed): the board scrolls to its card once,
// showing the skipped trends first when it is one of them.
export function TrendBoardView({ studio = {}, monday, api, action, disabled, pageHeading = false, askAdmin = 'an admin', onFindTrends, findLabel = 'Find new trends', onOpenRun, onOpenSheets, onReadReport, onCreateAssets, onMakeAssets, onSettings, onAsk, focus = null }) {
  const viewer = useViewer();
  const confirm = useConfirm();
  const seeCosts = hasCapability(viewer, 'seeCosts');
  const codex = studio.capabilities?.aiProvider === 'codex';
  // What this role may do here (in an admin's preview, the previewed role's), and write buttons that stay off in a preview.
  const mayDecide = canCall(viewer, 'decideResearchTheme');
  const mayWrite = canCall(viewer, 'approveResearchThemes') && canCall(viewer, 'continueResearchRun');
  const write = writeProps(viewer, disabled);
  const editionId = list(studio.workspaces).find((workspace) => workspace.id === studio.activeWorkspaceId)?.editionId || 'general';
  const channels = useMemo(() => routingChannels(editionId), [editionId]);
  // "Fits Social": the person's own channels (My channels) a trend is open to, routed there or to every channel.
  // Only a routed yes says which of the person's channels it fits; before that every trend is open to all of them.
  const fitsOf = (by) => (list(by?.channels).length ? fitsFor(by, viewer.prefs?.focusChannels, channels) : []);
  const [pending, setPending] = useState({}); // optimistic decisions so a card moves the instant it is decided
  const [boardError, setBoardError] = useState('');
  const [checkingRunId, setCheckingRunId] = useState(''); // reading the estimate for Write reports
  const [showPassed, setShowPassed] = useState(false);
  const [dragKey, setDragKey] = useState('');
  const [dropStage, setDropStage] = useState('');
  const researchRuns = useMemo(() => list(studio.researchRuns).map((run) => {
    const own = Object.entries(pending).filter(([key]) => splitKey(key)[0] === run.id);
    if (!own.length || run.status !== 'awaiting-review') return run;
    const decisions = { ...(run.decisions || {}) };
    for (const [key, decision] of own) { const themeId = splitKey(key)[1]; if (decision === 'pending') delete decisions[themeId]; else decisions[themeId] = decision; }
    return { ...run, decisions };
  }), [studio.researchRuns, pending]);
  const board = useMemo(() => buildTrendBoard({ researchRuns, contentRuns: studio.contentRuns, assets: studio.assets, programs: studio.programs }), [researchRuns, studio.contentRuns, studio.assets, studio.programs]);
  // Momentum across research runs (readTrendHistory), read again when a run moves on. Without it the cards show this
  // run's own facts, as before.
  const [history, setHistory] = useState(null);
  const runsKey = list(studio.researchRuns).map((run) => `${run.id}:${run.status || ''}:${run.stage || ''}:${Object.keys(run.decisions || {}).length}:${list(run.reportRunIds).length}`).join('|');
  useEffect(() => {
    if (typeof api?.readTrendHistory !== 'function') return undefined;
    let cancelled = false;
    Promise.resolve().then(() => api.readTrendHistory({})).then((result) => { if (!cancelled) setHistory(result || null); }).catch(() => { if (!cancelled) setHistory(null); });
    return () => { cancelled = true; };
  }, [runsKey, studio.activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendOf = useMemo(() => {
    const byTheme = new Map(); const byName = new Map();
    for (const trend of list(history?.trends)) { for (const id of list(trend.themeIds)) if (!byTheme.has(id)) byTheme.set(id, trend); if (!byName.has(nameKey(trend.name))) byName.set(nameKey(trend.name), trend); }
    return (card) => byTheme.get(card.themeId) || byName.get(nameKey(card.name)) || null;
  }, [history]);
  // Forget an optimistic decision once the saved state agrees with it.
  useEffect(() => {
    setPending((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key, decision]) => { const [runId, themeId] = splitKey(key); const run = list(studio.researchRuns).find((row) => row.id === runId); return run && run.status === 'awaiting-review' && (run.decisions?.[themeId] || 'pending') !== decision; }));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [studio.researchRuns]);

  function decide(card, decision) {
    if (!card?.canDecide || card.decision === decision || !canRun(viewer, 'decideResearchTheme')) return;
    setBoardError('');
    withViewTransition(() => setPending((current) => ({ ...current, [card.key]: decision })), ['trend-move']);
    Promise.resolve(api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision })).catch((error) => {
      withViewTransition(() => setPending((current) => { const next = { ...current }; delete next[card.key]; return next; }), ['trend-move']);
      setBoardError(error?.message || 'That decision could not be saved. Try again.');
    });
  }
  // "Yes, with a note…": saved before the card moves, so a refusal stays in the sheet with the note still typed.
  async function decideWithNote(card, { note, channels: routed }) {
    if (!card?.canDecide) return;
    setBoardError('');
    await api.decideResearchTheme({ runId: card.runId, themeId: card.themeId, decision: 'approved', note, channels: routed });
    withViewTransition(() => setPending((current) => ({ ...current, [card.key]: 'approved' })), ['trend-move']);
  }
  // Write reports: the estimate against what's left of the run's AI budget, in the same dialog and words as Simple and
  // Ask AI (cost-lines.js), before anything is approved or spent.
  async function generate(runId) {
    if (!canRun(viewer, 'approveResearchThemes') || !canRun(viewer, 'continueResearchRun') || checkingRunId) return;
    const { approved, undecided } = generationPlan(board.cards, runId);
    const run = runById.get(runId); const program = list(studio.programs).find((row) => row.id === run?.programId) || null;
    setCheckingRunId(runId);
    let cost = [];
    try { cost = seeCosts ? [await reportCostLine({ api, run, program, count: approved.length })] : []; } finally { setCheckingRunId(''); }
    const ok = await confirm({ title: `Write reports for ${plural(approved.length, 'approved trend')}?`, lines: [...cost, 'Each one gets a trends report and an editorial toolkit.', undecided.length ? `${plural(undecided.length, 'trend')} you haven’t decided on from the same run will be skipped.` : '', codex ? CODEX_UNCAPPED : ''], items: approved.map((card) => card.name).slice(0, 12), confirmLabel: 'Write reports' });
    if (!ok) return;
    await action('Starting reports', async () => {
      await api.approveResearchThemes({ runId, themes: approved.map((card) => card.themeId) });
      return api.continueResearchRun({ runId });
    }, `Writing reports for ${plural(approved.length, 'trend')}. Cards move to Ready as each one finishes.`);
  }
  function drop(stage) {
    const card = board.cards.find((row) => row.key === dragKey);
    setDragKey(''); setDropStage('');
    if (card && stage in DROP_DECISION) decide(card, DROP_DECISION[stage]);
  }
  // A trend opened from elsewhere: reveal it (a skipped one needs its row shown), then scroll to it once the page has
  // settled (the shell puts a newly opened page at the top first).
  const boardRef = useRef(null);
  const [scrollKey, setScrollKey] = useState('');
  useEffect(() => {
    if (!focus?.key) return;
    const card = board.cards.find((row) => row.themeId === focus.themeId);
    if (!card) return;
    if (card.stage === 'passed') setShowPassed(true);
    setScrollKey(card.key);
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!scrollKey) return undefined;
    const timer = setTimeout(() => {
      const node = [...(boardRef.current?.querySelectorAll('.tb-card') || [])].find((row) => row.dataset.cardKey === scrollKey);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      node?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      setScrollKey('');
    }, 60);
    return () => clearTimeout(timer);
  }, [scrollKey, showPassed]);
  const dragCard = board.cards.find((row) => row.key === dragKey);
  const approvedRuns = mayWrite ? [...new Set(board.columns.approved.filter((card) => card.canDecide).map((card) => card.runId))] : [];
  const runById = new Map(list(studio.researchRuns).map((run) => [run.id, run]));
  const Heading = pageHeading ? 'h1' : 'h2';
  const empty = !board.cards.length && !board.scouting.length;
  const stages = showPassed ? [...TREND_STAGES, PASSED_STAGE] : TREND_STAGES;

  // Monday.com (monday-ui.jsx): the board's sync status, Sync now (a background job; the server builds the cards) and the
  // log. Connecting happens in Settings, so only a role with Settings (onSettings) sees Connect or Choose a board.
  const mondayControl = <MondayStatusLine monday={monday} api={api} canSetup={Boolean(onSettings)} disabled={disabled} />;

  return <div className="tb-board" ref={boardRef}>
    <div className={`cs-section-heading ${pageHeading ? 'cs-page-heading' : ''}`}>
      <div><Heading id={pageHeading ? 'content-studio-title' : undefined}>Trend board</Heading><p>Research scouts the trends. You decide which ones become reports and campaigns.</p></div>
      <div className="tb-head-actions">{mondayControl}{onFindTrends && <Button type="button" disabled={disabled} onClick={onFindTrends}><Radar size={15} aria-hidden="true" />{findLabel}</Button>}</div>
    </div>
    {boardError && <p className="tb-note attention" role="alert">{boardError}</p>}
    {empty ? <div className="cs-empty"><span><Radar size={24} aria-hidden="true" /></span><h3>No trends on the board yet</h3><p>A research run reads the posts your program follows and brings every trend it finds to Needs your OK. Say yes to the ones worth a report, add a note for the channels if you like, then press Write reports. Nothing is written or spent until you do.</p>{onFindTrends ? <Button type="button" disabled={disabled} onClick={onFindTrends}>{findLabel}<ArrowRight size={14} aria-hidden="true" /></Button> : <p className="tb-note">Ask {askAdmin} to start a research run.</p>}</div>
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
                const plan = generationPlan(board.cards, runId); const checking = checkingRunId === runId;
                return <div key={runId} className="tb-batch">
                  <div><strong>{plan.approved[0]?.programName}</strong><small>{plural(plan.approved.length, 'approved trend')}{plan.undecided.length ? ` · ${number(plan.undecided.length)} still need your OK` : ''}</small></div>
                  <Button type="button" className="tb-ok" {...writeProps(viewer, disabled || Boolean(checkingRunId))} onClick={() => generate(runId)}>{checking ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}{checking ? 'Checking the cost…' : 'Write reports'}</Button>
                </div>;
              })}
              {cards.map((card) => { const by = decisionOf(studio.researchRuns, card); return <TrendCard key={card.key} card={card} trend={trendOf(card)} by={by} monday={monday} channels={channels} fits={fitsOf(by)} disabled={disabled} mayDecide={mayDecide} write={write} preview={Boolean(viewer.preview)} dragging={dragKey === card.key} api={api} onDecide={decide} onDecideWithNote={typeof api?.decideResearchTheme === 'function' ? decideWithNote : undefined} onAsk={onAsk} onDragStart={setDragKey} onDragEnd={() => { setDragKey(''); setDropStage(''); }} onOpenRun={onOpenRun} onReadReport={onReadReport} onCreateAssets={onCreateAssets} onMakeAssets={onMakeAssets} />; })}
              {!cards.length && !(stage.id === 'potential' && board.scouting.length) && !(stage.id === 'approved' && approvedRuns.length) && <p className="tb-column-empty">{droppable ? 'Drop here' : stage.empty}</p>}
            </div>
          </section>;
        })}
      </div>}
    {!empty && board.columns.passed.length > 0 && <Button type="button" className="cs-quiet tb-passed-toggle" aria-expanded={showPassed} onClick={() => withViewTransition(() => setShowPassed((open) => !open), ['trend-move'])}>{showPassed ? 'Hide skipped trends' : `Show ${plural(board.columns.passed.length, 'skipped trend')}`}</Button>}
  </div>;
}
