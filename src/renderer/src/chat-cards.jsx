import React, { createContext, useContext, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Brain, Check, ChevronDown, ChevronRight, Circle, CircleCheck, Copy, ExternalLink, FileText, FolderOpen, Gauge, HelpCircle, Images, Info, Link2, ListChecks, ListOrdered, LoaderCircle, Lock, MessageSquareQuote, Minus, PenLine, Plus, Radar, RotateCcw, ScanSearch, ScrollText, SkipForward, Sparkles, Square, Table2, TrendingDown, TrendingUp, TriangleAlert, Undo2, UserPlus, Eye } from 'lucide-react';
import QUICK_SCAN from '../../shared/quick-scan.json';
import { safeMarkdownUrl } from './markdown-content.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { CODEX_UNCAPPED, money, quickScanBlocked, quickScanCostLines } from './studio-actions.js';
import { adminNames, formatDay, formatTime, plural, useCan, useViewer, writeProps } from './viewer.js';
import { PromptDiff, diffCounts } from './prompt-library.jsx';
import { copyText } from './role-screens.jsx';
import { routingChannels } from './trend-decision-sheet.jsx';
import { brandFrom, checkBrand, checkSummary } from './brand-check.js';
import './ask-reply.css';
import './chat-cards.css';

// Cards under an Ask AI answer: structured, grounded blocks. The server hydrates each card from the studio's state
// (ids, numbers and statuses never come from the model) and drops cards it can't resolve. A card's buttons reuse the
// reply's actions by index (actionIndexes), so every paid button still runs through the shared action runner and its
// confirmation; navigation-only buttons (Open report, Open folder) call the layout's nav adapter directly. Live cards
// (a run, a folder, a trend waiting for an OK) re-read the pushed state by id, so they follow the work as it happens.
// Card shape (the renderer contract): { type, title, note, data, actionIndexes:[int] }; docs/design-review/SPEC.md §3.
// Cards that take input or run steps: action (a form over one button's params: data { kind, title, fields:[{ key, type,
// label, value, options, max }], problems, spends }), choice (data { options:[{ label, question }] }, or with pick: true
// options [{ label, detail, ids }] that run one button on the item picked), plan (data { steps:[{ index, why }] }), draft
// (data { kind, subject, text }) and report-change (data { assetId, section, diff, markdown, baseEditedAt, ... }).
//
// <ChatCards cards actions actionState onAction onRunAction onOutcome onAsk onNav api state conversationId messageId />
//   actions      the reply's actions (indexes refer to this array)
//   actionState  { [index]: { status:'running'|'done'|'failed'|'cancelled', text, runId? } } for this reply
//   onAction     (index) => Promise: runs reply action `index` and records its outcome (absent: no action buttons)
//   onRunAction  (request) => Promise<string|false>: runs a card's own request ({ kind, target, runId… }) through the same runner
//   onOutcome    (index, { status, text, runId }) => void: records what a card did with its action (the scan plan's start,
//                an action form's save, a choice, a plan step skipped)
//   onAsk        (text) => void: asks Ask AI a seeded question (Summarize what changed)
//   onNav        the layout's nav adapter (studio-actions.js StudioNav)
//   conversationId  the Ask AI conversation the answer belongs to (a prompt change saved from a card names it; a scan or
//                research run started from a card posts what it found back into it)
//   messageId    the stored answer the cards belong to (optional; sent with a start so the follow-up can name it)
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const text = (value) => (value == null ? '' : String(value));
const sentence = (value) => text(value).replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
const compact = (value) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
const messageOf = (failure) => String(failure?.message || failure || 'Something went wrong. Try again.');
const ACTIVE = new Set(['queued', 'running']);
const LIMITS = { lookbackHours: [1, 168], itemsPerPlatform: [10, 1000], maxTargets: [1, 50], commentsPerPost: [0, 50], aiBudgetUsd: [0.25, 50], collectionBudgetUsd: [0.25, 50], ...(QUICK_SCAN?.limits || {}) };
const PRESETS = QUICK_SCAN?.presets || {};
const PLATFORM_LABELS = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit', ...(QUICK_SCAN?.platformLabels || {}) };
const PLATFORMS = Object.keys(PLATFORM_LABELS);
const DEPTHS = Object.keys(PRESETS);
const PLATFORM_MARK = { x: 'X', linkedin: 'in', reddit: 'r/' };
const platformName = (id) => PLATFORM_LABELS[id] || sentence(id);
const STAGES = { waiting: 'Needs your OK', approved: 'Approved', writing: 'Being written', ready: 'Ready', passed: 'Skipped' };
const MOMENTUM = { new: { label: 'New', Icon: Sparkles, tone: 'is-live' }, rising: { label: 'Rising', Icon: TrendingUp, tone: 'is-ok' }, steady: { label: 'Steady', Icon: Minus, tone: '' }, fading: { label: 'Fading', Icon: TrendingDown, tone: 'is-warn' } };
// Badge tones (ask-reply.css .reply-badge): a stage, a run's status.
const STAGE_TONE = { waiting: 'is-warn', approved: 'is-ok', writing: 'is-live', ready: 'is-ok', passed: '' };
const STATUS_TONE = { succeeded: 'is-ok', partial: 'is-warn', 'awaiting-review': 'is-warn', failed: 'is-danger', running: 'is-live', queued: 'is-live', cancelled: '' };
const badge = (tone) => `reply-badge${tone ? ` ${tone}` : ''}`;
const DOC_KIND = { 'evidence-report': 'Trends report', 'editorial-toolkit': 'Editorial toolkit', 'scan-report': 'Quick scan report' };
const RUN_STATUS = { queued: 'Queued', running: 'Running', 'awaiting-review': 'Trends need your OK', succeeded: 'Done', partial: 'Partly done', failed: 'Didn’t finish', cancelled: 'Stopped' };
const RUN_STAGE = { collecting: 'Collecting posts', discovery: 'Finding trends', synthesis: 'Combining what it found', matching: 'Matching to trends you track', 'theme-review': 'Trends found', classification: 'Tagging posts', reports: 'Writing reports', 'scan-report': 'Writing the trends report', 'scan-complete': 'Scan complete', content: 'Writing' };
const WINDOWS = [[1, '1h'], [3, '3h'], [6, '6h'], [12, '12h'], [24, '24h'], [72, '3d'], [168, '7d']];
const windowLabel = (hours) => (WINDOWS.find(([value]) => value === hours)?.[1]) || (hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`);
// Dates as "Oct 12", or "2:14 PM" for today.
const when = (value) => { const date = new Date(value || 0); if (!value || Number.isNaN(date.getTime())) return ''; return date.toDateString() === new Date().toDateString() ? formatTime(value) : formatDay(value); };

const studioOf = (state) => state?.contentStudio || {};
// A channel owner's state has only their channel's sets (channelView.runs), so a folder card follows those.
function findRun(state, runId) {
  if (!runId) return null;
  const studio = studioOf(state);
  return [...list(studio.researchRuns), ...list(studio.contentRuns), ...list(studio.channelView?.runs)].find((row) => row.id === runId) || null;
}
const progressOf = (value) => (value && finite(value.total) && Number(value.total) > 0 ? { done: Number(value.done ?? value.completed) || 0, total: Number(value.total) } : null);
// A run as the run card shows it, from the pushed state (live) or the hydrated card (until the state has it).
function runView(row) {
  const kind = row.origin === 'quick-scan' ? 'quick-scan' : row.type === 'research' ? 'research' : row.kit ? 'kit' : 'content';
  const themes = list(row.discoveredThemes).length ? row.discoveredThemes : list(row.themes);
  return {
    runId: row.id, kind, title: row.kit ? `Channel assets · ${row.kit.sourceTitle || row.title || ''}` : row.title || 'Research run', status: row.status, stage: row.stage, message: row.message || '', startedAt: row.createdAt,
    costUsd: row.costUsd, budgetUsd: row.maxBudgetUsd, progress: progressOf(row.status === 'running' ? row.discoveryProgress || row.assignmentProgress || row.progress : row.progress), themes: themes.map((theme) => (typeof theme === 'string' ? theme : theme?.name)).filter(Boolean),
    topic: row.quickScan?.topic || '', programId: row.programId || '', codex: row.ai?.route === 'codex' || list(row.receipts).some((receipt) => receipt?.provider === 'codex'),
    scanReport: row.scanReport && typeof row.scanReport === 'object' ? row.scanReport : null,
  };
}
// The link a start sends so the studio can post what it finds back into this conversation (a stored answer's id only).
export function askLinkFor(conversationId, messageId = '', actionIndex = -1) {
  if (!conversationId) return null;
  return { conversationId: String(conversationId), ...(/^msg-[0-9a-f-]{36}$/.test(String(messageId || '')) ? { messageId: String(messageId) } : {}), ...(Number.isInteger(actionIndex) && actionIndex >= 0 ? { actionIndex } : {}) };
}
function runLine(run) {
  if (run.status === 'queued') return 'Starting soon';
  if (run.message) return run.message;
  if (run.stage === 'discovery' && run.progress) return `Finding trends · batch ${run.progress.done} of ${run.progress.total}`;
  return RUN_STAGE[run.stage] || (run.stage ? sentence(run.stage) : '');
}
// The indexes of the reply's actions that cards render, so the answer doesn't offer the same button twice.
export function cardActionIndexes(cards, actions = []) {
  const indexes = new Set();
  for (const card of list(cards)) {
    if (!RENDERERS[card?.type]) continue;
    for (const index of list(card.actionIndexes)) if (Number.isInteger(index) && actions[index]) indexes.add(index);
    if (card.type === 'scan-plan') { const index = scanActionIndex(card, actions); if (index >= 0) indexes.add(index); }
    if (card.type === 'prompt-change') { const index = promptActionIndex(card, actions); if (index >= 0) indexes.add(index); }
    if (card.type === 'report-change') { const index = reportActionIndex(card, actions); if (index >= 0) indexes.add(index); }
  }
  return indexes;
}
const scanActionIndex = (card, actions) => { const named = list(card.actionIndexes).find((index) => actions[index]?.kind === 'quick-scan'); return named ?? list(actions).findIndex((row) => row?.kind === 'quick-scan'); };
const promptActionIndex = (card, actions) => { const named = list(card.actionIndexes).find((index) => actions[index]?.kind === 'edit-prompt'); return named ?? list(actions).findIndex((row) => row?.kind === 'edit-prompt'); };
const reportActionIndex = (card, actions) => { const named = list(card.actionIndexes).find((index) => actions[index]?.kind === 'edit-report'); return named ?? list(actions).findIndex((row) => row?.kind === 'edit-report'); };
// An open button for this kind of item (open with type=report, or the older open-report).
const opensAs = (row, type) => row?.kind === `open-${type}` || (row?.kind === 'open' && (row.params?.type === type || row.ref?.kind === type));

// primary: whether these cards may hold the reply's one primary button (help-assistant.jsx gives it to the first card
// that has open work, else to the actions row under the cards; see primaryCard).
export function ChatCards({ cards, actions = [], actionState = {}, onAction, onRunAction, onOutcome, onAsk, onNav = {}, api, state, conversationId = '', messageId = '', primary = true }) {
  const can = useCan();
  const rows = list(cards).filter((card) => card && RENDERERS[card.type]);
  if (!rows.length) return null;
  const shared = { actions: list(actions), actionState: actionState || {}, onAction, onRunAction, onOutcome, onAsk, onNav: onNav || {}, api, state, conversationId, messageId };
  const lead = primary ? primaryCard(rows, shared.actions, shared.actionState, state, { canAct: Boolean(onAction), canRunAction: Boolean(onRunAction), canAsk: Boolean(onAsk), can, api }) : -1;
  return <div className="chat-cards">{rows.map((card, index) => { const Card = RENDERERS[card.type]; return <PrimaryContext.Provider key={`${card.type}-${index}`} value={index === lead}><Card card={card} {...shared} /></PrimaryContext.Provider>; })}</div>;
}

// Every card is one shell (ask-reply.css): a 28px icon tile tinted by family, an eyebrow and a title, the body, and the
// card's own buttons in a footer row. Families: research and trends are mint, assets and reports soft, questions and
// choices warm, numbers neutral.
const FAMILY = { trend: 'mint', run: 'mint', program: 'mint', posts: 'mint', 'scan-plan': 'mint', report: 'soft', 'asset-folder': 'soft', 'report-change': 'soft', 'prompt-change': 'soft', draft: 'soft', picture: 'soft', choice: 'warm', plan: 'warm', action: 'warm', checklist: 'warm', metric: 'neutral', chart: 'neutral', table: 'neutral', compare: 'neutral', memory: 'neutral' };
// `label` names the card for screen readers when its title alone wouldn't (the memory card: "Remembered from this
// answer"); otherwise the card is named by its title. The card's type is data-card, never a class: chat-cards.css names
// parts after their card (.cc-compare is the two columns, .cc-draft the text box), and a class would restyle the shell.
export function ReplyCard({ type, family = '', kicker, title, label = '', icon: Icon, note, aside, children }) {
  const id = useId();
  return <article className="reply-card" data-card={type} aria-labelledby={label ? undefined : id} aria-label={label || undefined} data-spot={type === 'scan-plan' ? 'ask.scan-plan' : undefined}>
    <header className="reply-card-head">{Icon && <span className={`reply-card-icon is-${family || FAMILY[type] || 'neutral'}`} aria-hidden="true"><Icon size={15} /></span>}<div className="reply-card-heading">{kicker && <span className="reply-card-eyebrow">{kicker}</span>}<h4 id={id} className="reply-card-title">{title || kicker}</h4></div>{aside}</header>
    {note && <p className="reply-body">{note}</p>}
    {children}
  </article>;
}
const CardShell = ReplyCard;

// A reply has at most one primary button. The reply's own buttons that only open, copy, stop, skip or ask are always
// quiet; the first button in the chosen card (or in the actions row, when no card has open work) that does the work is
// the primary. Inside a card, its own main step can be that work: Copy on a draft (the draft is what it's for), and
// Summarize what changed on a finished run.
const QUIET_ACTIONS = new Set(['pass-trend', 'undo-trend', 'open-report', 'open-folder', 'open', 'open-tab', 'open-tracker', 'stop-run', 'copy', 'ask', 'view-as', 'save-folder', 'export-run']);
export const isQuietAction = (kind) => QUIET_ACTIONS.has(kind);
export const BUTTON = { primary: 'studio-primary small', quiet: 'studio-quiet small' };
const PrimaryContext = createContext(true);
// Hands out this card's share: the first button that asks for the primary gets it (when the reply gave it to this card),
// every other one is quiet. Called while rendering, in reading order.
export function primaryPicker(allowed = true) { let spent = !allowed; return (wants) => { if (wants && !spent) { spent = true; return BUTTON.primary; } return BUTTON.quiet; }; }
const usePrimary = () => primaryPicker(useContext(PrimaryContext));
const isDone = (status) => status?.status === 'done';
// A plan step is settled once done or skipped (a skip is recorded as cancelled with its words; a plain "no" is not).
const planSettled = (status) => ['done', 'skipped'].includes(status?.status) || (status?.status === 'cancelled' && Boolean(status.text));
// The run a quick-scan start recorded: its id when the outcome kept it, else the newest quick scan its result line names.
function startedRunId(outcome, state) {
  if (!isDone(outcome)) return '';
  if (outcome.runId) return outcome.runId;
  const named = /“([^”]+)”/.exec(outcome.text || '')?.[1];
  return (named && list(studioOf(state).researchRuns).filter((row) => row.origin === 'quick-scan' && row.title === named).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]?.id) || '';
}
// Whether a card has open work for the reply's primary: a form to save, a change to apply, a step to run, a trend to
// decide, a run to try again or summarize, a draft to copy, or a button of the reply's that does the work. Judged the
// way the card draws its buttons, who may press them included, so the card given the primary always shows it.
// ways: { canAct (reply actions run), canRunAction (a card runs its own request), canAsk (a card asks a question),
// can (the person's methods), api (what this studio offers) }.
function wantsPrimary(card, actions, actionState, state, ways) {
  const { canAct = true, can = () => true, api = null } = ways;
  const data = card.data || {};
  const open = (index) => Number.isInteger(index) && Boolean(actions[index]) && !isDone(actionState[index]);
  // A reply action the card draws (CardActions) that does the work; `skip` leaves out the ones the card doesn't draw.
  const doing = (skip = () => false) => canAct && list(card.actionIndexes).some((index) => open(index) && !isQuietAction(actions[index].kind) && !skip(actions[index], index));
  switch (card.type) {
    case 'scan-plan': {
      const index = scanActionIndex(card, actions); const outcome = index >= 0 ? actionState[index] : null;
      // Started: the card is now the run it started (or a done line).
      if (isDone(outcome)) { const runId = startedRunId(outcome, state); return Boolean(runId) && wantsPrimary({ type: 'run', actionIndexes: [], data: { runId, kind: 'quick-scan', status: 'queued' } }, actions, {}, state, ways); }
      if (!can('estimateQuickScan') && !can('startQuickScan')) return false;
      // Check cost leads until the plan is priced (Start scan takes over after); without Check cost, Start scan never
      // gets a fresh price, so it stays quiet.
      return (typeof api?.estimateQuickScan === 'function' && can('estimateQuickScan')) || doing((row) => row.kind === 'quick-scan');
    }
    case 'action': return open(list(card.actionIndexes)[0]);
    case 'prompt-change': { const index = promptActionIndex(card, actions); return Boolean(data.canApply) && typeof api?.savePromptVersion === 'function' && can('savePromptVersion') && !(index >= 0 && isDone(actionState[index])); }
    case 'report-change': { const index = reportActionIndex(card, actions); return Boolean(data.canApply) && typeof api?.editStudioAsset === 'function' && can('editStudioAsset') && !(index >= 0 && isDone(actionState[index])); }
    case 'plan': { const steps = list(data.steps).filter((step) => Number.isInteger(step?.index) && actions[step.index]); return canAct && steps.length >= 2 && steps.some((step) => !planSettled(actionState[step.index])); }
    case 'trend': {
      // Once decided, the card leaves out Yes and Skip (TrendCard), unless one has an outcome to show.
      const stage = liveTrendStage(state, data) || data.stage; const decided = Boolean(stage) && stage !== 'waiting';
      return doing((row, index) => decided && ['approve-trend', 'pass-trend'].includes(row.kind) && !actionState[index]);
    }
    case 'run': {
      const { canRunAction = canAct, canAsk = true } = ways;
      const live = findRun(state, data.runId); const run = live ? runView(live) : data;
      const quick = run.kind === 'quick-scan'; const report = quick ? run.scanReport || null : null;
      const indexes = list(card.actionIndexes);
      const reportRetry = report?.runId ? indexes.find((index) => actions[index]?.kind === 'retry-run' && actions[index].runId === report.runId) : undefined;
      const indexOf = (kind) => (kind === 'retry-report' ? reportRetry : indexes.find((index) => actions[index]?.kind === kind && index !== reportRetry));
      // RunCard's own Try again and Retry report: drawn when allowed and something can run them, and not yet done.
      const offers = (kind, allowed) => { const index = indexOf(kind); return allowed && !(index != null && isDone(actionState[index])) && (canRunAction || (index != null && canAct)); };
      const found = ['succeeded', 'awaiting-review', 'partial'].includes(run.status) && (run.kind === 'research' || quick);
      return offers('retry-run', ['failed', 'partial', 'cancelled'].includes(run.status) && can('retryStudioRun'))
        || offers('retry-report', run.status === 'succeeded' && ['failed', 'cancelled'].includes(report?.status) && Boolean(report?.runId) && can('retryStudioRun'))
        || (found && canAsk)
        || doing((row) => ['stop-run', 'retry-run'].includes(row.kind) || (row.kind === 'start-research' && quick && run.status === 'succeeded'));
    }
    case 'draft': return Boolean(text(data.text).trim());
    case 'choice': case 'memory': return false;
    // Cards that draw nothing without their rows have no buttons either.
    case 'metric': return list(data.items).some((row) => row && (row.label || row.value)) && doing();
    case 'table': return list(data.columns).length > 0 && list(data.rows).some(Array.isArray) && doing();
    case 'checklist': return list(data.items).some((row) => row?.text) && doing();
    case 'compare': return [data.left, data.right].filter((side) => side && (side.title || list(side.points).length)).length >= 2 && doing();
    case 'posts': return list(data.posts).some((post) => post?.text) && doing();
    default: return doing();
  }
}
// The index (among the cards that render) of the card that holds the reply's one primary, or -1 for none. `ways` as
// wantsPrimary takes it; ChatCards and the reply's actions row (help-assistant.jsx) pass the same, so they agree.
export function primaryCard(cards, actions = [], actionState = {}, state = null, ways = {}) {
  return list(cards).filter((card) => card && RENDERERS[card.type]).findIndex((card) => wantsPrimary(card, list(actions), actionState || {}, state, ways || {}));
}

// The reply's actions a card points at, as buttons in reading order. `skip` leaves out the ones the card draws itself;
// children are the card's own navigation buttons, shown first. `pick` is the card's primary picker when it draws its
// own buttons too, so the card still has one primary at most.
const ACTION_ICON = { 'approve-trend': Check, 'undo-trend': Undo2, 'open-report': FileText, 'open-folder': FolderOpen, open: ArrowRight, 'make-assets': Images, 'retry-run': RotateCcw, 'finish-assets': RotateCcw, 'stop-run': Square, 'start-research': Radar, 'quick-scan': ScanSearch, 'open-tracker': Table2, copy: Link2, 'set-status': Check, 'mark-used': Check, 'edit-report': PenLine, ask: Sparkles, 'invite-people': UserPlus, 'view-as': Eye, 'lock-prompt': Lock };
export const actionIcon = (kind) => ACTION_ICON[kind] || Sparkles;
function CardActions({ card, actions, actionState, onAction, skip, pick, children }) {
  const fallback = usePrimary(); const tone = pick || fallback;
  const rows = onAction ? list(card.actionIndexes).filter((index, at, all) => Number.isInteger(index) && actions[index] && all.indexOf(index) === at && !(skip && skip(actions[index]))) : [];
  const own = React.Children.toArray(children).filter(Boolean);
  if (!rows.length && !own.length) return null;
  return <div className="reply-card-foot">{own}{rows.map((index) => {
    const row = actions[index]; const status = actionState[index]; const Icon = actionIcon(row.kind);
    return <div className="reply-action" key={index}>{status?.status === 'done'
      ? <span className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>
      : <button type="button" className={tone(!isQuietAction(row.kind))} disabled={status?.status === 'running'} onClick={() => onAction(index)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}{row.label}</button>}
      {status?.status === 'failed' && <small className="reply-failed" role="alert">{status.text}</small>}</div>;
  })}</div>;
}
const NavButton = ({ icon: Icon = ArrowRight, label, onClick }) => <button type="button" className={BUTTON.quiet} onClick={onClick}><Icon size={14} aria-hidden="true" />{label}</button>;

function Sparkline({ points, label }) {
  const values = list(points).map(Number).filter(Number.isFinite).slice(-24);
  if (values.length < 2) return null;
  const W = 72; const H = 22; const max = Math.max(...values); const min = Math.min(0, ...values); const span = max - min || 1;
  const xy = values.map((value, index) => [2 + (index * (W - 6)) / (values.length - 1), 3 + (H - 6) * (1 - (value - min) / span)]);
  const [lastX, lastY] = xy[xy.length - 1];
  return <svg className="cc-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label || `Across runs: ${values.join(', ')}`}>
    <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" />
    <circle cx={lastX} cy={lastY} r="2.5" />
  </svg>;
}
function Progress({ done, total, label }) {
  const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return <div className="reply-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total}`}><span style={{ width: `${percent}%` }} /></div>;
}

// Trend: momentum, how it moved across runs, where it is, and Yes / Skip / Open report.
function liveTrendStage(state, data) {
  const row = list(studioOf(state).researchRuns).find((item) => item.id === data.runId);
  if (!row || row.status !== 'awaiting-review' || !data.themeId) return '';
  const decision = row.decisions?.[data.themeId];
  return decision === 'approved' ? 'approved' : decision === 'passed' ? 'passed' : 'waiting';
}
export function TrendCard({ card, actions, actionState, onAction, onNav, state }) {
  const data = card.data || {};
  const stage = liveTrendStage(state, data) || data.stage;
  const momentum = MOMENTUM[data.momentum];
  const spark = list(data.spark);
  const meta = [data.category, data.priorityTier && sentence(String(data.priorityTier).toLowerCase()), finite(data.evidenceCount) && Number(data.evidenceCount) > 0 ? plural(data.evidenceCount, 'post') : '', list(data.platforms).map(platformName).join(' · '), stage === 'waiting' && data.runLabel ? `From ${data.runLabel}` : ''].filter(Boolean);
  const seen = [finite(data.runsSeen) && Number(data.runsSeen) > 0 ? `Seen in ${plural(data.runsSeen, 'run')}` : '', data.firstSeen ? `first ${formatDay(data.firstSeen)}` : '', data.lastSeen && data.lastSeen !== data.firstSeen ? `last ${formatDay(data.lastSeen)}` : ''].filter(Boolean).join(' · ');
  // Once decided, Yes and Skip give way to what was chosen.
  const decided = stage && stage !== 'waiting';
  return <CardShell type="trend" kicker="Trend" title={card.title || data.name} icon={TrendingUp} note={card.note} aside={momentum && <span className={badge(momentum.tone)}><momentum.Icon size={12} aria-hidden="true" />{momentum.label}</span>}>
    {meta.length > 0 && <p className="reply-muted">{meta.join(' · ')}</p>}
    {data.summary && <p className="reply-body cc-clamp">{data.summary}</p>}
    {data.answer && <p className="reply-muted">Your channel: {data.answer}</p>}
    {(spark.length > 1 || seen || STAGES[stage]) && <div className="cc-trend-foot">{spark.length > 1 && <Sparkline points={spark} label={`Posts across runs: ${spark.join(', ')}`} />}{seen && <small className="reply-muted">{seen}</small>}{STAGES[stage] && <span className={badge(STAGE_TONE[stage])}>{STAGES[stage]}</span>}</div>}
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} skip={(row) => decided && ['approve-trend', 'pass-trend'].includes(row.kind) && !actionState[actions.indexOf(row)]}>
      {data.reportAssetId && typeof onNav.openReport === 'function' && <NavButton key="open" icon={FileText} label="Open report" onClick={() => onNav.openReport(data.reportAssetId)} />}
    </CardActions>
  </CardShell>;
}

export function ReportCard({ card, actions, actionState, onAction, onNav }) {
  const data = card.data || {};
  const kind = DOC_KIND[data.kind] || (data.kind ? sentence(data.kind) : 'Report');
  const opens = Boolean(data.assetId) && typeof onNav.openReport === 'function'; // else a reply's own Open button stays
  return <CardShell type="report" kicker={kind} title={card.title || data.title || 'Report'} icon={FileText} note={card.note}>
    {(data.trendName || data.date) && <p className="reply-muted">{[data.trendName && `Trend: ${data.trendName}`, formatDay(data.date)].filter(Boolean).join(' · ')}</p>}
    {data.excerpt && <p className="reply-body cc-clamp">{data.excerpt}</p>}
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} skip={(row) => opensAs(row, 'report') && opens}>
      {opens && <NavButton key="open" icon={FileText} label="Open" onClick={() => onNav.openReport(data.assetId)} />}
    </CardActions>
  </CardShell>;
}

const FOLDER_STATUS = { queued: 'Starting soon', running: 'Making assets…', succeeded: 'Ready', partial: 'Some assets need another try', failed: 'Didn’t finish', cancelled: 'Stopped' };
export function AssetFolderCard({ card, actions, actionState, onAction, onNav, state }) {
  const data = card.data || {};
  const live = findRun(state, data.latestRunId);
  const jobs = list(live?.jobs);
  const total = jobs.length || Number(live?.progress?.total) || Number(data.total) || 0;
  const ready = jobs.length ? jobs.filter((job) => job.status === 'succeeded').length : Number(live?.progress?.completed ?? data.ready) || 0;
  const status = live?.status || data.status;
  const channels = list(data.channels).filter((row) => row?.name);
  const opens = Boolean(data.sourceKey) && typeof onNav.openFolder === 'function';
  return <CardShell type="asset-folder" kicker="Channel assets" title={card.title || data.title || 'Asset folder'} icon={FolderOpen} note={card.note}>
    <p className="reply-muted">{ACTIVE.has(status) && <LoaderCircle className="spin" size={12} aria-hidden="true" />}{[FOLDER_STATUS[status] || sentence(status), total ? `${ready} of ${total} ready` : ''].filter(Boolean).join(' · ')}</p>
    {total > 0 && <Progress done={ready} total={total} label={`${card.title || data.title || 'Folder'}: ${ready} of ${total} assets ready`} />}
    {channels.length > 0 && <ul className="reply-chips" aria-label="Channels">{channels.slice(0, 12).map((row) => <li key={row.name} className="reply-chip">{row.name}{finite(row.count) && <span className="reply-chip-count">{row.count}</span>}</li>)}</ul>}
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} skip={(row) => opensAs(row, 'folder') && opens}>
      {opens && <NavButton key="open" icon={FolderOpen} label="Open folder" onClick={() => onNav.openFolder(data.sourceKey)} />}
    </CardActions>
  </CardShell>;
}

// Run: follows the run through pushed state; Stop while it works, Try again when it stopped, and Summarize what
// changed (a seeded question) once it found something. A finished quick scan offers a full research run with the
// program it borrowed its accounts from: that run reads the program's whole saved setup (not only the scan's topic),
// so the button names the program and the usual confirmation shows its estimate. A reply action of the same kind is
// used when there is one, so its outcome is recorded with the conversation.
// A quick scan writes a short trends report when it finishes: Open the report when it's ready, Retry report (the report
// alone; the scan stays done) when it didn't finish.
export function RunCard({ card, actions, actionState, onAction, onRunAction, onAsk, onNav, state, conversationId = '', messageId = '' }) {
  const can = useCan(); const viewer = useViewer(); const pick = usePrimary();
  const data = card.data || {};
  const live = findRun(state, data.runId);
  const run = live ? runView(live) : { ...data, progress: progressOf(data.progress), themes: list(data.themes) };
  const [local, setLocal] = useState({});
  const quick = run.kind === 'quick-scan';
  const topic = run.topic || text(run.title).replace(/^Quick scan · /, '');
  const report = quick ? run.scanReport || null : null;
  // A reply's Retry report button (retry-run on the report run) is this card's Retry report, not its Try again.
  const reportRetryIndex = report?.runId ? list(card.actionIndexes).find((index) => actions[index]?.kind === 'retry-run' && actions[index].runId === report.runId) : undefined;
  const indexOf = (kind) => (kind === 'retry-report' ? reportRetryIndex : list(card.actionIndexes).find((index) => actions[index]?.kind === kind && index !== reportRetryIndex));
  const stateOf = (kind) => { const index = indexOf(kind); return index != null ? actionState[index] : local[kind]; };
  const programId = run.programId || data.programId || '';
  const programName = list(studioOf(state).programs).find((row) => row.id === programId)?.name || '';
  async function act(kind) {
    const index = indexOf(kind);
    if (index != null && onAction) { onAction(index); return; }
    if (!onRunAction) return;
    setLocal((current) => ({ ...current, [kind]: { status: 'running' } }));
    try {
      const ask = askLinkFor(conversationId, messageId);
      const request = kind === 'start-research' ? { kind, label: 'Full research', target: programName, programId, ...(ask ? { ask } : {}) }
        : kind === 'retry-report' ? { kind: 'retry-run', label: 'Retry report', target: 'Quick scan trends report', runId: report?.runId || '' }
          : { kind, label: kind === 'stop-run' ? 'Stop' : 'Try again', target: run.title, runId: run.runId || data.runId };
      const result = await onRunAction(request);
      setLocal((current) => ({ ...current, [kind]: result === false ? undefined : { status: 'done', text: typeof result === 'string' ? result : 'Done.' } }));
    } catch (failure) { setLocal((current) => ({ ...current, [kind]: { status: 'failed', text: messageOf(failure) } })); }
  }
  const active = ACTIVE.has(run.status);
  const stopped = ['failed', 'partial', 'cancelled'].includes(run.status);
  const found = ['succeeded', 'awaiting-review', 'partial'].includes(run.status) && (run.kind === 'research' || quick);
  const own = (kind, label, Icon, allowed) => {
    const status = stateOf(kind);
    if (status?.status !== 'done' && (!allowed || !(onRunAction || (indexOf(kind) != null && onAction)))) return null;
    if (status?.status === 'done') return <span key={kind} className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>;
    return <span key={kind} className="reply-action"><button type="button" className={pick(kind === 'retry-run' || kind === 'retry-report')} {...writeProps(viewer, status?.status === 'running')} onClick={() => act(kind)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}{label}</button>{status?.status === 'failed' && <small className="reply-failed" role="alert">{status.text}</small>}</span>;
  };
  const cost = finite(run.costUsd) && Number(run.costUsd) > 0 ? `${money(run.costUsd)} AI so far${finite(run.budgetUsd) && Number(run.budgetUsd) > 0 ? ` of ${money(run.budgetUsd)}` : ''}` : finite(run.budgetUsd) && Number(run.budgetUsd) > 0 ? `AI budget ${money(run.budgetUsd)}` : '';
  const kicker = quick ? 'Quick scan' : run.kind === 'kit' ? 'Channel assets' : run.kind === 'content' ? 'Report run' : 'Research run';
  const status = quick && run.status === 'succeeded' ? 'Scan complete' : RUN_STATUS[run.status] || sentence(run.status);
  return <CardShell type="run" family={run.kind === 'kit' || run.kind === 'content' ? 'soft' : 'mint'} kicker={kicker} title={card.title || run.title} icon={quick ? ScanSearch : run.kind === 'kit' ? Images : Radar} note={card.note} aside={status && <span className={badge(STATUS_TONE[run.status])}>{active && <LoaderCircle className="spin" size={12} aria-hidden="true" />}{status}</span>}>
    <div className="cc-run-live" aria-live="polite">
      {runLine(run) && <p className="reply-muted">{runLine(run)}</p>}
      {run.progress && <Progress done={run.progress.done} total={run.progress.total} label={`${run.title}: ${run.progress.done} of ${run.progress.total}`} />}
    </div>
    {(cost || run.startedAt) && <p className="reply-muted">{[run.startedAt && `Started ${when(run.startedAt)}`, cost, run.codex ? 'Codex (not metered)' : ''].filter(Boolean).join(' · ')}</p>}
    {run.themes.length > 0 && <ul className="reply-chips" aria-label={quick ? 'Themes found' : 'Trends found'}>{run.themes.slice(0, 6).map((name) => <li key={name} className="reply-chip">{name}</li>)}{run.themes.length > 6 && <li className="reply-chip is-more">+{run.themes.length - 6} more</li>}</ul>}
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} pick={pick} skip={(row) => ['stop-run', 'retry-run'].includes(row.kind) || (row.kind === 'start-research' && quick && run.status === 'succeeded')}>
      {own('stop-run', 'Stop', Square, active && can('cancelStudioRun'))}
      {own('retry-run', 'Try again', RotateCcw, stopped && can('retryStudioRun'))}
      {own('retry-report', 'Retry report', RotateCcw, run.status === 'succeeded' && ['failed', 'cancelled'].includes(report?.status) && Boolean(report?.runId) && can('retryStudioRun'))}
      {report?.status === 'succeeded' && report.assetId && typeof onNav.openReport === 'function' && <NavButton key="report" icon={FileText} label="Open the report" onClick={() => onNav.openReport(report.assetId)} />}
      {found && onAsk && <button key="summarize" type="button" className={pick(true)} {...writeProps(viewer)} onClick={() => onAsk(quick ? `Summarize what the quick scan “${topic}” found: what people are saying, and which trends are new, rising or fading.` : `Summarize what changed in “${run.title}”: which trends are new, rising or fading since the last run.`)}><Sparkles size={14} aria-hidden="true" />Summarize what changed</button>}
      {own('start-research', programName ? `Full research with “${programName}”` : 'Start full research', Radar, quick && run.status === 'succeeded' && Boolean(programId) && can('startResearchRun'))}
      {run.status === 'awaiting-review' && typeof onNav.openTab === 'function' && <NavButton key="review" icon={TrendingUp} label="Review the trends" onClick={() => onNav.openTab('trends')} />}
    </CardActions>
  </CardShell>;
}

// Program: what it reads, its window, schedule and caps; Start research / Quick scan come from the reply's actions.
const SOURCE_WORD = { x: 'account', linkedin: 'profile', reddit: 'subreddit' };
function windowText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (finite(value.lookbackHours) && Number(value.lookbackHours) > 0) return `Last ${windowLabel(Number(value.lookbackHours))}`;
  if (value.startDate) return `${formatDay(value.startDate)} to ${value.endDate ? formatDay(value.endDate) : 'now'}`;
  if (finite(value.lookbackDays)) return `Last ${plural(value.lookbackDays, 'day')}`;
  return '';
}
function scheduleText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (!value.frequency || value.frequency === 'manual') return 'Runs when you start it';
  const next = value.nextRunAt ? `, next ${when(value.nextRunAt)}` : '';
  return value.enabled === false ? `${sentence(value.frequency)} (paused)` : `${sentence(value.frequency)}${next}`;
}
export function ProgramCard({ card, actions, actionState, onAction, onNav }) {
  const data = card.data || {};
  const sources = PLATFORMS.map((id) => { const raw = data.sources?.[id]; const count = Array.isArray(raw) ? raw.length : Number(raw) || 0; return count ? `${platformName(id)}: ${plural(count, SOURCE_WORD[id] || 'source')}` : ''; }).filter(Boolean);
  const caps = [finite(data.budgets?.aiUsd) && `AI ${money(data.budgets.aiUsd)}`, finite(data.budgets?.collectionUsd) && `Apify ${money(data.budgets.collectionUsd)}`].filter(Boolean);
  const facts = [['Window', windowText(data.window)], ['Schedule', scheduleText(data.schedule)], ['Caps', caps.join(' · ')]].filter(([, value]) => value);
  // See the program opens Research programs on this program (openTarget), else on the page alone.
  const see = data.programId && typeof onNav.openTarget === 'function' ? () => onNav.openTarget({ kind: 'program', id: String(data.programId) })
    : typeof onNav.openPage === 'function' ? () => onNav.openPage('research') : null;
  return <CardShell type="program" kicker="Research program" title={card.title || data.name || 'Research program'} icon={Radar} note={card.note}>
    {sources.length > 0 && <p className="reply-muted">{sources.join(' · ')}</p>}
    {facts.length > 0 && <dl className="cc-facts">{facts.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>}
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction}>
      {see && <NavButton key="see" icon={ArrowRight} label="See the program" onClick={see} />}
    </CardActions>
  </CardShell>;
}

const TONE_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus };
export function MetricCard({ card, actions, actionState, onAction }) {
  const items = list(card.data?.items).filter((row) => row && (row.label || row.value)).slice(0, 4);
  if (!items.length) return null;
  return <CardShell type="metric" kicker="At a glance" title={card.title} icon={Gauge} note={card.note}>
    <dl className="cc-metrics" data-count={items.length}>{items.map((row, index) => { const Icon = TONE_ICON[row.tone]; return <div key={index} className="cc-metric">
      <dt>{row.label}</dt><dd><strong>{text(row.value)}</strong>{row.delta && <span className={`cc-delta is-${row.tone || 'flat'}`}>{Icon && <Icon size={12} aria-hidden="true" />}{row.delta}</span>}</dd>
    </div>; })}</dl>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}

// Chart: an inline SVG line or bar chart (server-built from trend history), with a hover and keyboard readout, a
// legend for two or more series, a text summary for screen readers and the numbers in a hidden table.
const isDateLike = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
function niceStep(range) {
  const rough = range / 3 || 1; const power = 10 ** Math.floor(Math.log10(rough)); const unit = rough / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}
function formatValue(value, unit) {
  if (!finite(value)) return '—';
  const number = Number(value); const kind = String(unit || '').trim();
  if (kind === '%') return `${Math.round(number * 10) / 10}%`;
  if (/^(usd|\$)$/i.test(kind)) return money(number);
  return `${Math.abs(number) >= 1000 ? compact(number) : Math.round(number * 100) / 100}${kind ? ` ${kind}` : ''}`;
}
export function ChartCard({ card, actions, actionState, onAction }) {
  const data = card.data || {};
  return <CardShell type="chart" kicker="Chart" title={card.title} icon={data.kind === 'bar' ? Table2 : TrendingUp} note={card.note}>
    <Chart kind={data.kind === 'bar' ? 'bar' : 'line'} unit={data.unit} series={data.series} title={card.title || 'Chart'} />
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}
function Chart({ kind, unit, series, title }) {
  const [hover, setHover] = useState(null);
  const rows = list(series).filter((row) => list(row?.points).length).slice(0, 4).map((row, index) => ({ label: text(row.label) || `Series ${index + 1}`, points: list(row.points).filter((point) => point && point.x != null) }));
  const xs = useMemo(() => {
    const seen = []; for (const row of rows) for (const point of row.points) { const key = text(point.x); if (!seen.includes(key)) seen.push(key); }
    return seen.every(isDateLike) ? seen.sort((a, b) => Date.parse(a) - Date.parse(b)) : seen;
  }, [series]);
  if (!rows.length || !xs.length) return <p className="reply-muted">No numbers to chart yet.</p>;
  const valueAt = (row, x) => { const point = row.points.find((item) => text(item.x) === x); return point && finite(point.y) ? Number(point.y) : null; };
  const all = rows.flatMap((row) => xs.map((x) => valueAt(row, x))).filter((value) => value != null);
  const high = Math.max(0, ...all); const low = Math.min(0, ...all);
  const step = niceStep(high - low); const top = Math.ceil(high / step) * step || step; const bottom = Math.floor(low / step) * step;
  const ticks = []; for (let value = bottom; value <= top + step / 2 && ticks.length < 6; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  const W = 320; const H = 156; const L = 40; const R = 14; const T = 12; const B = 26; const plotW = W - L - R; const plotH = H - T - B;
  const band = plotW / xs.length;
  const xAt = (index) => (kind === 'bar' ? L + band * (index + 0.5) : xs.length === 1 ? L + plotW / 2 : L + (index * plotW) / (xs.length - 1));
  const yAt = (value) => T + plotH * (1 - (value - bottom) / (top - bottom || 1));
  const xLabel = (x) => (isDateLike(x) ? formatDay(x) : x.length > 12 ? `${x.slice(0, 11)}…` : x);
  const labelled = xs.length <= 2 ? xs.map((_, index) => index) : [0, ...(xs.length >= 5 ? [Math.floor((xs.length - 1) / 2)] : []), xs.length - 1];
  const summary = `${kind === 'bar' ? 'Bar' : 'Line'} chart, ${title}. ${rows.map((row) => { const values = xs.map((x) => [x, valueAt(row, x)]).filter(([, value]) => value != null); if (!values.length) return `${row.label}: no data`; const [firstX, first] = values[0]; const [lastX, last] = values[values.length - 1]; return values.length === 1 ? `${row.label}: ${formatValue(first, unit)} on ${xLabel(firstX)}` : `${row.label}: ${formatValue(first, unit)} on ${xLabel(firstX)} to ${formatValue(last, unit)} on ${xLabel(lastX)}`; }).join('. ')}.`;
  const barWidth = Math.max(3, Math.min(24, (band * 0.72) / rows.length - 2));
  const barPath = (x, value) => {
    const base = yAt(Math.max(bottom, Math.min(0, top))); const y = yAt(value); const w = barWidth;
    if (value < 0) return `M${x},${base}H${x + w}V${y}H${x}Z`;
    const r = Math.min(4, w / 2, Math.max(0, base - y));
    return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
  };
  const move = (event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setHover((current) => { const at = current ?? xs.length - 1; return event.key === 'Home' ? 0 : event.key === 'End' ? xs.length - 1 : Math.max(0, Math.min(xs.length - 1, at + (event.key === 'ArrowLeft' ? -1 : 1))); }); };
  const tipLeft = hover == null ? 0 : (xAt(hover) / W) * 100;
  return <figure className="cc-chart">
    <div className="cc-chart-frame">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} tabIndex={0} onKeyDown={move} onFocus={() => setHover((current) => current ?? xs.length - 1)} onBlur={() => setHover(null)} onPointerLeave={() => setHover(null)}>
        {ticks.map((value) => <g key={value}><line className={value === 0 ? 'cc-axis' : 'cc-grid'} x1={L} x2={W - R} y1={yAt(value)} y2={yAt(value)} /><text className="cc-tick" x={L - 6} y={yAt(value) + 3} textAnchor="end">{formatValue(value, unit === '%' || /^(usd|\$)$/i.test(String(unit || '')) ? unit : '')}</text></g>)}
        {labelled.map((index) => <text key={index} className="cc-tick" x={xAt(index)} y={H - 8} textAnchor={kind === 'bar' || xs.length === 1 ? 'middle' : index === 0 ? 'start' : index === xs.length - 1 ? 'end' : 'middle'}>{xLabel(xs[index])}</text>)}
        {kind === 'bar' && hover != null && <rect className="cc-hover-band" x={L + band * hover} y={T} width={band} height={plotH} />}
        {kind === 'bar' && rows.map((row, seriesIndex) => <g key={row.label} className={`cc-series s${seriesIndex + 1}`}>{xs.map((x, index) => { const value = valueAt(row, x); if (value == null) return null; const start = xAt(index) - (rows.length * (barWidth + 2) - 2) / 2 + seriesIndex * (barWidth + 2); return <path key={x} className="cc-bar" d={barPath(start, value)} />; })}</g>)}
        {kind === 'line' && hover != null && <line className="cc-crosshair" x1={xAt(hover)} x2={xAt(hover)} y1={T} y2={T + plotH} />}
        {kind === 'line' && rows.map((row, seriesIndex) => { const points = xs.map((x, index) => [index, valueAt(row, x)]).filter(([, value]) => value != null); const last = points[points.length - 1]; const shown = hover != null ? points.find(([index]) => index === hover) : null; return <g key={row.label} className={`cc-series s${seriesIndex + 1}`}>
          {points.length > 1 && <path className="cc-line" d={points.map(([index, value], at) => `${at ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join('')} />}
          {last && <circle className="cc-dot" cx={xAt(last[0])} cy={yAt(last[1])} r="4" />}
          {shown && shown !== last && <circle className="cc-dot" cx={xAt(shown[0])} cy={yAt(shown[1])} r="4" />}
        </g>; })}
        {xs.map((x, index) => <rect key={x} className="cc-hit" x={kind === 'bar' ? L + band * index : xAt(index) - (xs.length > 1 ? plotW / (xs.length - 1) / 2 : plotW / 2)} y={0} width={kind === 'bar' ? band : xs.length > 1 ? plotW / (xs.length - 1) : plotW} height={H} onPointerEnter={() => setHover(index)} onPointerMove={() => setHover(index)} />)}
      </svg>
      {hover != null && <div className={`cc-tooltip${tipLeft > 70 ? ' is-end' : tipLeft < 30 ? ' is-start' : ''}`} style={{ left: `${tipLeft}%` }} aria-hidden="true">
        <span className="cc-tooltip-x">{xLabel(xs[hover])}</span>
        {rows.map((row, seriesIndex) => <span key={row.label} className="cc-tooltip-row"><i className={`cc-key s${seriesIndex + 1}${kind === 'bar' ? ' is-box' : ''}`} /><strong>{formatValue(valueAt(row, xs[hover]), unit)}</strong>{rows.length > 1 && <span>{row.label}</span>}</span>)}
      </div>}
    </div>
    {rows.length > 1 && <ul className="cc-legend">{rows.map((row, seriesIndex) => <li key={row.label}><i className={`cc-key s${seriesIndex + 1}${kind === 'bar' ? ' is-box' : ''}`} aria-hidden="true" />{row.label}</li>)}</ul>}
    <table className="cc-sr-only"><caption>{title}</caption><thead><tr><th scope="col">Point</th>{rows.map((row) => <th scope="col" key={row.label}>{row.label}</th>)}</tr></thead>
      <tbody>{xs.map((x) => <tr key={x}><th scope="row">{xLabel(x)}</th>{rows.map((row) => <td key={row.label}>{formatValue(valueAt(row, x), unit)}</td>)}</tr>)}</tbody></table>
  </figure>;
}

export function TableCard({ card, actions, actionState, onAction }) {
  const columns = list(card.data?.columns).slice(0, 5).map(text);
  const rows = list(card.data?.rows).filter(Array.isArray).slice(0, 8);
  if (!columns.length || !rows.length) return null;
  return <CardShell type="table" kicker="Table" title={card.title} icon={Table2} note={card.note}>
    <div className="cc-table-wrap" tabIndex={0} role="region" aria-label={card.title || 'Table'}><table className="cc-table">
      <thead><tr>{columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((_, index) => index === 0 ? <th scope="row" key={index}>{text(row[index])}</th> : <td key={index}>{text(row[index])}</td>)}</tr>)}</tbody>
    </table></div>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}

export function ChecklistCard({ card, actions, actionState, onAction }) {
  const items = list(card.data?.items).filter((row) => row?.text);
  if (!items.length) return null;
  const done = items.filter((row) => row.done).length;
  return <CardShell type="checklist" kicker={`${done} of ${items.length} done`} title={card.title || 'Checklist'} icon={ListChecks} note={card.note}>
    <ul className="cc-checklist">{items.map((row, index) => <li key={index} className={row.done ? 'is-done' : ''}>{row.done ? <CircleCheck size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}<span>{row.text}<span className="cc-sr-only">{row.done ? ' (done)' : ' (to do)'}</span></span></li>)}</ul>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}

export function CompareCard({ card, actions, actionState, onAction }) {
  const sides = [card.data?.left, card.data?.right].filter((side) => side && (side.title || list(side.points).length));
  if (sides.length < 2) return null;
  return <CardShell type="compare" kicker="Compare" title={card.title || `${sides[0].title} and ${sides[1].title}`} icon={Table2} note={card.note}>
    <div className="cc-compare">{sides.map((side, index) => <section key={index} aria-label={side.title || (index ? 'Right' : 'Left')}><h5>{side.title}</h5><ul>{list(side.points).slice(0, 8).map((point, at) => <li key={at}>{text(point)}</li>)}</ul></section>)}</div>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}

// Posts: real posts quoted from collected evidence (the `posts` lookup), with the platform and a link to the source.
function SourceLink({ url, api, label = 'View post' }) {
  const safe = safeMarkdownUrl(url);
  if (!safe) return null;
  return <a className="cc-link" href={safe} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (typeof api?.openSourceUrl === 'function') { event.preventDefault(); Promise.resolve(api.openSourceUrl(safe)).catch(() => {}); } }}>{label}<ExternalLink size={12} aria-hidden="true" /></a>;
}
function Post({ post, api }) {
  const [open, setOpen] = useState(false);
  const body = text(post.text);
  const long = body.length > 280;
  const meta = [post.publishedAt && when(post.publishedAt), finite(post.engagement) && Number(post.engagement) > 0 ? `${compact(post.engagement)} engagements` : ''].filter(Boolean).join(' · ');
  return <li className="cc-post">
    <div className="cc-post-head"><span className={`cc-mark is-${post.platform || 'web'}`} role="img" aria-label={platformName(post.platform || 'web')}>{PLATFORM_MARK[post.platform] || '•'}</span><strong>{post.author || 'Someone'}</strong>{meta && <small className="reply-muted">{meta}</small>}</div>
    <blockquote className={long && !open ? 'cc-clamp' : ''}>{body}</blockquote>
    <div className="cc-post-foot">{long && <button type="button" className="reply-text-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Show less' : 'Show more'}</button>}<SourceLink url={post.url} api={api} /></div>
  </li>;
}
export function PostsCard({ card, actions, actionState, onAction, api }) {
  const posts = list(card.data?.posts).filter((post) => post?.text).slice(0, 12);
  if (!posts.length) return null;
  return <CardShell type="posts" kicker={plural(posts.length, 'post')} title={card.title || 'What people are saying'} icon={MessageSquareQuote} note={card.note}>
    <ul className="cc-posts">{posts.map((post, index) => <Post key={post.url || index} post={post} api={api} />)}</ul>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} />
  </CardShell>;
}

// Memory: what Ask AI just remembered from this answer, each with Undo (forget it).
export function MemoryCard({ card, api }) {
  const can = useCan(); const viewer = useViewer();
  const items = list(card.data?.items).filter((row) => row?.id && row.text);
  const [states, setStates] = useState({});
  if (!items.length) return null;
  const canForget = typeof api?.forgetAskMemory === 'function' && can('forgetAskMemory');
  async function forget(id) {
    setStates((current) => ({ ...current, [id]: { status: 'running' } }));
    try { await api.forgetAskMemory({ id }); setStates((current) => ({ ...current, [id]: { status: 'done' } })); }
    catch (failure) { setStates((current) => ({ ...current, [id]: { status: 'failed', text: messageOf(failure) } })); }
  }
  return <CardShell type="memory" kicker="Memory" title={card.title || 'Remembered'} label={card.title ? `${card.title} from this answer` : 'Remembered from this answer'} icon={Brain}>
    <ul className="reply-memory">{items.map((row) => { const status = states[row.id]; return <li key={row.id} className={status?.status === 'done' ? 'is-forgotten' : ''}>
      <span>{row.text}</span>
      {status?.status === 'done' ? <small className="reply-muted" role="status">Forgotten</small> : canForget && <button type="button" className={BUTTON.quiet} {...writeProps(viewer, status?.status === 'running')} aria-label={`Undo: forget “${row.text}”`} onClick={() => forget(row.id)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}Undo</button>}
      {status?.status === 'failed' && <small className="reply-failed" role="alert">{status.text}</small>}
    </li>; })}</ul>
  </CardShell>;
}

// Scan plan: the quick scan Ask AI proposed, as controls the person can change. Check cost prices the plan exactly as
// shown (the accounts it would read and why, AI against its cap, Apify's worst case against its cap); any change makes
// that price stale, and Start scan needs a fresh one. Starting confirms once more, then the card becomes the run.
const num = (value) => (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 ? -1 : Number(value));
export function scanDraft(input = {}, topic = '') {
  const depth = PRESETS[input?.depth] ? input.depth : DEPTHS[0] || 'lite';
  const platforms = [...new Set(list(input?.platforms).filter((id) => PLATFORM_LABELS[id]))];
  return {
    topic: text(input?.topic || topic).trim().slice(0, 500), depth, platforms: platforms.length ? platforms : [...PLATFORMS],
    maxTargets: Object.fromEntries(PLATFORMS.map((id) => [id, num(input?.maxTargets?.[id])])), itemsPerPlatform: num(input?.itemsPerPlatform), commentsPerPost: num(input?.commentsPerPost),
    lookbackHours: num(input?.lookbackHours), aiBudgetUsd: num(input?.aiBudgetUsd), collectionBudgetUsd: num(input?.collectionBudgetUsd), programId: text(input?.programId),
    // The short trends report the scan writes when it finds trends (on unless turned off; its cost is in the check).
    report: input?.report !== false && input?.report !== 'false',
  };
}
const FALLBACK = { lookbackHours: 24, itemsPerPlatform: 60, commentsPerPost: 0, aiBudgetUsd: 1.5, collectionBudgetUsd: 1.5, maxTargets: 8 };
function Stepper({ label, value, min, max, step = 1, decimals = 0, prefix = '', onChange, disabled }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  const fit = (raw) => Math.min(max, Math.max(min, Number(Number(raw).toFixed(decimals))));
  const commit = () => { if (draft == null) return; const raw = Number(draft); setDraft(null); if (draft !== '' && Number.isFinite(raw)) onChange(fit(raw)); };
  return <div className="cc-stepper">
    <label htmlFor={id}>{label}</label>
    <div className="cc-stepper-box">
      <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(fit(value - step))}><Minus size={13} aria-hidden="true" /></button>
      {prefix && <span className="cc-prefix" aria-hidden="true">{prefix}</span>}
      <input id={id} type="number" inputMode={decimals ? 'decimal' : 'numeric'} min={min} max={max} step={decimals ? step : 1} disabled={disabled} value={draft ?? (decimals ? Number(value).toFixed(decimals) : String(value))} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(fit(value + step))}><Plus size={13} aria-hidden="true" /></button>
    </div>
  </div>;
}
function Meter({ label, value, cap, words, tone }) {
  const share = finite(value) && finite(cap) && Number(cap) > 0 ? Math.min(100, Math.round((Number(value) / Number(cap)) * 100)) : 0;
  const level = tone || (share >= 100 ? 'is-over' : share >= 85 ? 'is-near' : '');
  return <div className={`cc-meter ${level}`}>
    <div className="cc-meter-text"><span>{label}</span><strong>{words}</strong></div>
    {finite(cap) && Number(cap) > 0 && <div className="cc-meter-track" role="meter" aria-label={`${label} against its cap`} aria-valuemin={0} aria-valuemax={Number(cap)} aria-valuenow={Math.min(Number(cap), Number(value) || 0)} aria-valuetext={words}><span style={{ width: `${share}%` }} /></div>}
  </div>;
}
export function ScanPlanCard({ card, actions, actionState, onAction, onRunAction, onOutcome, onAsk, onNav, api, state, conversationId = '', messageId = '' }) {
  const can = useCan(); const viewer = useViewer(); const confirm = useConfirm(); const pick = usePrimary();
  const formId = useId();
  const index = scanActionIndex(card, actions);
  const offered = index >= 0 ? actions[index] : null;
  const outcome = index >= 0 ? actionState[index] : null;
  const studio = studioOf(state);
  const workspaceId = studio.activeWorkspaceId;
  const programs = list(studio.programs).filter((row) => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId);
  const [scan, setScan] = useState(() => scanDraft({ ...(offered?.scan || {}), ...(card.data?.scan || {}) }, offered?.target));
  const [programId, setProgramId] = useState(() => {
    const wanted = card.data?.programId || scan.programId;
    if (wanted || !programs.length) return wanted || '';
    return (programs.length === 1 ? programs[0] : [...programs].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0]).id;
  });
  const [estimate, setEstimate] = useState(null);
  const [estimateKey, setEstimateKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(null);
  const [customHours, setCustomHours] = useState(false);
  const request = useRef(0);
  const preset = PRESETS[scan.depth] || {};
  const key = JSON.stringify([programId, scan]);
  const fresh = Boolean(estimate) && estimateKey === key;
  const stale = Boolean(estimate) && !fresh;
  const known = estimate?.scan || {};
  // What a control shows: the person's own value, else the depth preset's, else what the server last normalized it to.
  const shown = (field) => (scan[field] >= 0 ? scan[field] : finite(preset[field]) ? Number(preset[field]) : finite(known[field]) && Number(known[field]) >= 0 ? Number(known[field]) : FALLBACK[field]);
  const shownTargets = (id) => (scan.maxTargets[id] >= 0 ? scan.maxTargets[id] : finite(preset.maxTargets?.[id]) ? Number(preset.maxTargets[id]) : finite(known.maxTargets?.[id]) ? Number(known.maxTargets[id]) : FALLBACK.maxTargets);
  const hours = scan.lookbackHours >= 0 ? scan.lookbackHours : finite(preset.lookbackHours) ? Number(preset.lookbackHours) : finite(known.lookbackHours) ? Number(known.lookbackHours) : FALLBACK.lookbackHours;
  const edit = (patch) => { setScan((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) })); setError(''); };
  // A new depth starts from its own preset: every number follows it again.
  const chooseDepth = (depth) => edit({ depth, maxTargets: Object.fromEntries(PLATFORMS.map((id) => [id, -1])), itemsPerPlatform: -1, commentsPerPost: -1, aiBudgetUsd: -1, collectionBudgetUsd: -1 });
  const togglePlatform = (id) => edit((current) => ({ platforms: current.platforms.includes(id) ? current.platforms.filter((row) => row !== id) : PLATFORMS.filter((row) => row === id || current.platforms.includes(row)) }));
  const payload = () => ({ ...scan, topic: scan.topic.trim(), programId });
  const program = programs.find((row) => row.id === programId) || null;
  const programName = program?.name || card.data?.programName || estimate?.programName || '';
  const canCheck = typeof api?.estimateQuickScan === 'function' && can('estimateQuickScan');
  const canStart = typeof api?.startQuickScan === 'function' && can('startQuickScan');
  const uncapped = Boolean(estimate?.uncapped || estimate?.route === 'codex' || studio.capabilities?.aiProvider === 'codex');

  async function check() {
    if (!scan.topic.trim()) { setError('Say what the scan should look for.'); return; }
    const id = ++request.current; const keyNow = key;
    setChecking(true); setError('');
    try {
      const result = await api.estimateQuickScan({ programId, scan: payload() });
      if (id !== request.current) return;
      setEstimate(result || {}); setEstimateKey(keyNow);
    } catch (failure) { if (id === request.current) setError(messageOf(failure)); }
    finally { if (id === request.current) setChecking(false); }
  }
  async function start() {
    if (!fresh || starting || quickScanBlocked(estimate)) return;
    const ok = await confirm({ title: `Start a quick scan on “${scan.topic.trim()}”?`, lines: [programName ? `Accounts come from “${programName}”. The saved program and its schedule aren’t changed.` : '', ...quickScanCostLines(estimate)], confirmLabel: 'Start scan' });
    if (!ok) return;
    setStarting(true); setError('');
    try {
      // The conversation it was planned in, where the studio posts its trends report when it finishes.
      const ask = askLinkFor(conversationId, messageId, index);
      const result = await api.startQuickScan({ programId, scan: payload(), fingerprint: estimate.fingerprint || '', ...(ask ? { ask } : {}) });
      const row = result?.run || result || {};
      const runId = row.id || row.runId || '';
      const title = row.title || `Quick scan · ${scan.topic.trim()}`;
      const line = `Started “${title}”.`;
      setStarted({ runId, title, row });
      if (index >= 0) onOutcome?.(index, { status: 'done', text: line, ...(runId ? { runId } : {}) });
    } catch (failure) {
      const words = messageOf(failure);
      setError(words);
      // The server re-derived a different plan (accounts or posts changed since the check): price it again.
      if (/plan changed/i.test(words)) setEstimateKey('');
    } finally { setStarting(false); }
  }

  // A start recorded in an earlier session: its run id when the store kept it, else the run named in the result line.
  const runId = started?.runId || outcome?.runId || (!started ? startedRunId(outcome, state) : '') || '';
  if (runId) {
    const row = started?.row || {};
    return <RunCard card={{ type: 'run', title: '', note: '', actionIndexes: [], data: { runId, kind: 'quick-scan', title: started?.title || `Quick scan · ${scan.topic}`, status: row.status || 'queued', stage: row.stage || 'collecting', message: row.message || '', startedAt: row.createdAt || '', costUsd: row.costUsd || 0, budgetUsd: row.maxBudgetUsd, progress: null, themes: [] } }} actions={actions} actionState={{}} onAction={onAction} onRunAction={onRunAction} onAsk={onAsk} onNav={onNav} state={state} conversationId={conversationId} messageId={messageId} />;
  }
  if (outcome?.status === 'done') return <p className="reply-done" role="status"><Check size={14} aria-hidden="true" />{outcome.text}</p>;
  // Quick scans can be turned off for one person (Access): no planner they can't check or start, just who to ask.
  if (!can('estimateQuickScan') && !can('startQuickScan')) {
    return <CardShell type="scan-plan" kicker="Quick scan plan" title={card.title || (scan.topic ? `Quick scan · ${scan.topic}` : 'Quick scan')} icon={ScanSearch} note={card.note}>
      <p className="reply-note"><Lock size={13} aria-hidden="true" />Quick scans are off for you. Ask {adminNames(state, 'an admin')} to turn them on.</p>
    </CardShell>;
  }

  const targets = list(estimate?.plan?.targets);
  const warnings = [...new Set([...list(estimate?.warnings), ...list(estimate?.collection?.warnings)].map(String))];
  const ai = estimate?.ai || {}; const collection = estimate?.collection || {};
  const aiCap = finite(known.aiBudgetUsd) ? known.aiBudgetUsd : shown('aiBudgetUsd');
  const apifyCap = finite(collection.totalBudgetUsd) ? collection.totalBudgetUsd : finite(known.collectionBudgetUsd) ? known.collectionBudgetUsd : shown('collectionBudgetUsd');
  const [itemsMin, itemsMax] = LIMITS.itemsPerPlatform; const [targetsMin, targetsMax] = LIMITS.maxTargets; const [commentsMin, commentsMax] = LIMITS.commentsPerPost;
  const [hoursMin, hoursMax] = LIMITS.lookbackHours; const [aiMin, aiMax] = LIMITS.aiBudgetUsd; const [apifyMin, apifyMax] = LIMITS.collectionBudgetUsd;
  const busy = checking || starting;
  const blocked = fresh && quickScanBlocked(estimate);
  // The cost lines the meters don't already show (describeScan words AI and Apify against their caps).
  const planLines = list(estimate?.lines).map(String).filter((line) => !/^(AI|Apify)\b/.test(line));
  return <CardShell type="scan-plan" kicker="Quick scan plan" title={card.title || (scan.topic ? `Quick scan · ${scan.topic}` : 'Quick scan')} icon={ScanSearch} note={card.note}>
    <form className="cc-plan" aria-describedby={`${formId}-hint`} onSubmit={(event) => { event.preventDefault(); check(); }}>
      <p id={`${formId}-hint`} className="reply-muted">Change anything, then check the cost. Nothing is collected or spent until you press Start scan and confirm.</p>
      <label className="cc-field"><span>Look for</span><input value={scan.topic} maxLength={500} onChange={(event) => edit({ topic: event.target.value })} placeholder="A topic, like “AI Overviews”" /></label>
      {programs.length > 1
        ? <label className="cc-field"><span>Accounts from</span><select value={programId} onChange={(event) => setProgramId(event.target.value)}>{programs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        : programName ? <p className="reply-muted">Accounts from “{programName}”. The saved program isn’t changed.</p> : null}
      {DEPTHS.length > 0 && <fieldset className="cc-segment"><legend>How deep</legend>{DEPTHS.map((depth) => <label key={depth} className={scan.depth === depth ? 'is-on' : ''}><input type="radio" name={`${formId}-depth`} value={depth} checked={scan.depth === depth} onChange={() => chooseDepth(depth)} /><span>{PRESETS[depth]?.label || sentence(depth)}</span></label>)}</fieldset>}
      <fieldset className="cc-toggles"><legend>Platforms</legend>{PLATFORMS.map((id) => { const on = scan.platforms.includes(id); return <label key={id} className={on ? 'is-on' : ''}><input type="checkbox" checked={on} disabled={on && scan.platforms.length === 1} onChange={() => togglePlatform(id)} /><span>{platformName(id)}</span></label>; })}</fieldset>
      <div className="cc-steppers">
        {scan.platforms.map((id) => <Stepper key={id} label={`${platformName(id)} ${id === 'reddit' ? 'subreddits' : 'accounts'}`} value={shownTargets(id)} min={targetsMin} max={targetsMax} onChange={(value) => edit((current) => ({ maxTargets: { ...current.maxTargets, [id]: value } }))} />)}
        <Stepper label="Posts per platform" value={shown('itemsPerPlatform')} min={itemsMin} max={itemsMax} step={10} onChange={(value) => edit({ itemsPerPlatform: value })} />
        <Stepper label="Comments per post" value={shown('commentsPerPost')} min={commentsMin} max={commentsMax} onChange={(value) => edit({ commentsPerPost: value })} />
      </div>
      <fieldset className="cc-windows"><legend>Posts from the last</legend>
        {WINDOWS.filter(([value]) => value >= hoursMin && value <= hoursMax).map(([value, label]) => <label key={value} className={!customHours && hours === value ? 'is-on' : ''}><input type="radio" name={`${formId}-window`} checked={!customHours && hours === value} onChange={() => { setCustomHours(false); edit({ lookbackHours: value }); }} /><span>{label}</span></label>)}
        <label className={customHours || !WINDOWS.some(([value]) => value === hours) ? 'is-on' : ''}><input type="radio" name={`${formId}-window`} checked={customHours || !WINDOWS.some(([value]) => value === hours)} onChange={() => setCustomHours(true)} /><span>Custom</span></label>
      </fieldset>
      {(customHours || !WINDOWS.some(([value]) => value === hours)) && <div className="cc-steppers"><Stepper label="Hours" value={hours} min={hoursMin} max={hoursMax} onChange={(value) => edit({ lookbackHours: value })} /></div>}
      <div className="cc-steppers">
        <Stepper label="AI cap" prefix="$" decimals={2} step={0.25} value={shown('aiBudgetUsd')} min={aiMin} max={aiMax} onChange={(value) => edit({ aiBudgetUsd: value })} />
        <Stepper label="Apify cap" prefix="$" decimals={2} step={0.25} value={shown('collectionBudgetUsd')} min={apifyMin} max={apifyMax} onChange={(value) => edit({ collectionBudgetUsd: value })} />
      </div>
      <label className="cc-plan-toggle"><input type="checkbox" checked={scan.report !== false} onChange={(event) => edit({ report: event.target.checked })} /><span>Write a short trends report when it finds trends<small>Posted here in Ask AI. Its cost is part of the check.</small></span></label>
      {uncapped && !estimate && <p className="reply-note"><Info size={13} aria-hidden="true" />{CODEX_UNCAPPED}</p>}

      {estimate && <section className={`cc-estimate${stale ? ' is-stale' : ''}`} aria-label="Cost check" aria-busy={checking}>
        {stale && <p className="reply-note" role="status"><Info size={13} aria-hidden="true" />You changed the plan. Check the cost again before starting.</p>}
        {planLines.length > 0 && <ul className="cc-plan-lines">{planLines.map((line, at) => <li key={at}>{line}</li>)}</ul>}
        <Meter label="AI" value={ai.totalUsd} cap={uncapped ? null : aiCap} words={finite(ai.totalUsd) ? `about ${money(ai.totalUsd)}${uncapped ? ' (not capped on Codex)' : ` of ${money(aiCap)} cap`}` : 'No estimate'} />
        {ai.report?.on && <p className="cc-meter-note">{finite(ai.report.usd) && Number(ai.report.usd) > 0 && !uncapped ? `Includes a short trends report, about ${money(ai.report.usd)}.` : 'Includes a short trends report.'}</p>}
        <Meter label="Apify, worst case" value={collection.worstCaseUsd} cap={apifyCap} words={finite(collection.worstCaseUsd) ? `up to ${money(collection.worstCaseUsd)} of ${money(apifyCap)} cap` : collection.error || 'No estimate'} />
        {targets.length > 0 && <details className="cc-targets"><summary>Accounts it will read · {targets.length}<ChevronDown size={13} aria-hidden="true" /></summary>
          {PLATFORMS.filter((id) => targets.some((row) => row.platform === id)).map((id) => <div key={id} className="cc-target-group"><h5>{platformName(id)}</h5><ul>{targets.filter((row) => row.platform === id).map((row, at) => <li key={`${row.target}-${at}`}><strong>{row.target}</strong><small>{list(row.reasons).join(' · ') || 'In the program’s saved order'}</small></li>)}</ul></div>)}
        </details>}
        {warnings.length > 0 && <ul className="cc-warnings">{warnings.slice(0, 5).map((line) => <li key={line}><TriangleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
        {uncapped && <p className="reply-note"><Info size={13} aria-hidden="true" />{CODEX_UNCAPPED}</p>}
        {blocked && <p className="reply-failed" role="status">This scan can’t start as planned. Change what the warnings point at, then check again.</p>}
      </section>}
      {(error || (outcome?.status === 'failed' && outcome.text)) && <p className="reply-failed" role="alert">{error || outcome.text}</p>}
      <div className="reply-card-foot">
        {canCheck && <button type="submit" className={pick(!fresh)} disabled={busy || !scan.topic.trim()}>{checking ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <Gauge size={13} aria-hidden="true" />}{checking ? 'Checking…' : estimate ? 'Check again' : 'Check cost'}</button>}
        {canStart && <button type="button" className={pick(fresh)} {...writeProps(viewer, !fresh || blocked || busy)} title={viewer.preview ? undefined : fresh ? undefined : 'Check the cost first'} onClick={start}>{starting ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <ScanSearch size={13} aria-hidden="true" />}{starting ? 'Starting…' : 'Start scan'}</button>}
        {canStart && !fresh && !viewer.preview && <small className="reply-muted">{stale ? 'Check the cost again to start.' : 'Check the cost first.'}</small>}
        {!canStart && <small className="reply-muted">{can('startQuickScan') ? 'Quick scans aren’t available in this version of the studio.' : 'Quick scans are off for you.'}</small>}
      </div>
    </form>
    <CardActions card={card} actions={actions} actionState={actionState} onAction={onAction} pick={pick} skip={(row) => row.kind === 'quick-scan'} />
  </CardShell>;
}

// Prompt change: Ask AI's suggested edit to one part of a prompt, as the server checked it (the same rules a save runs)
// against the saved text. Apply saves it as the next version, credited to Ask AI and this conversation, and records the
// outcome on its edit-prompt button, so a reopened conversation shows it was applied. Nothing saves without the click.
// A newer save since the suggestion (state.contentStudio.promptChanges) turns Apply off; the server refuses it anyway.
export function PromptChangeCard({ card, actions, actionState, onOutcome, onNav, api, state, conversationId }) {
  const can = useCan(); const viewer = useViewer(); const pick = usePrimary();
  const data = card.data || {};
  const index = promptActionIndex(card, actions);
  const recorded = index >= 0 ? actionState[index] : null;
  const [local, setLocal] = useState(null);
  const status = local || recorded;
  const running = status?.status === 'running';
  const lines = list(data.diff); const counts = finite(data.added) ? { added: Number(data.added), removed: Number(data.removed) || 0 } : diffCounts(lines);
  const problems = list(data.problems).map(text).filter(Boolean);
  const newer = list(studioOf(state).promptChanges).find((row) => row?.promptId === data.promptId && row.current && Number(row.version) > Number(data.version));
  const canSave = typeof api?.savePromptVersion === 'function' && can('savePromptVersion');
  const ready = Boolean(data.canApply) && canSave && !newer && Boolean(data.promptId && data.blockId && typeof data.text === 'string');
  const next = finite(data.nextVersion) ? Number(data.nextVersion) : (Number(data.version) || 0) + 1;
  const askAdmin = adminNames(state, 'an admin');
  async function apply() {
    if (!ready || running) return;
    setLocal({ status: 'running' });
    try {
      const saved = await api.savePromptVersion({ id: data.promptId, blocks: { [data.blockId]: data.text }, expectedVersion: Number(data.version) || 0, note: text(data.note).trim() || 'Suggested by Ask AI.', source: 'ask-ai', conversationId: text(conversationId) });
      const done = { status: 'done', text: saved?.changed === false ? `“${data.promptName}” already says this, so nothing changed.` : `Saved as version ${saved?.version ?? next} of “${data.promptName}”.` };
      setLocal(done); if (index >= 0) onOutcome?.(index, done);
    } catch (failure) {
      const failed = { status: 'failed', text: messageOf(failure) };
      setLocal(failed); if (index >= 0) onOutcome?.(index, failed);
    }
  }
  const lockedOut = data.locked && !data.canApply && !problems.length;
  return <CardShell type="prompt-change" kicker="Suggested prompt change" title={card.title || data.promptName || 'Prompt'} icon={ScrollText} note={card.note} aside={<span className={badge(data.locked ? 'is-outline' : 'is-live')}>{data.locked ? <><Lock size={12} aria-hidden="true" />Locked</> : `v${Number(data.version) || 0} → v${next}`}</span>}>
    <p className="reply-muted">{[data.blockLabel, `${plural(counts.added, 'line')} added`, `${plural(counts.removed, 'line')} removed`].filter(Boolean).join(' · ')}</p>
    {data.note && <p className="reply-body">{data.note}</p>}
    <PromptDiff lines={lines} label={`Changes to ${data.blockLabel || 'the prompt'}`} className="cc-diff" />
    {finite(data.diffShortened) && <p className="reply-muted">Showing the first {plural(lines.length, 'line')} of {Number(data.diffShortened)}. Open it in Prompts to see the rest.</p>}
    {problems.length > 0 && <ul className="cc-warnings" aria-label="Why it can’t be applied yet">{problems.map((line) => <li key={line}><TriangleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
    {lockedOut && <p className="reply-note"><Lock size={13} aria-hidden="true" />An admin locked this prompt, so only an admin can apply the change. Ask {askAdmin}.</p>}
    {newer && status?.status !== 'done' && <p className="reply-note" role="status"><Info size={13} aria-hidden="true" />{newer.byName || 'Someone'} saved version {newer.version} after this suggestion. Ask again for one based on it, or open it in Prompts.</p>}
    {data.canApply && !canSave && <p className="reply-muted">Your role can see prompts but not change them.</p>}
    {status?.status === 'failed' && <p className="reply-failed" role="alert">{status.text}</p>}
    <div className="reply-card-foot">
      {status?.status === 'done'
        ? <span className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>
        : data.canApply && canSave && <span className="reply-action"><button type="button" className={pick(true)} {...writeProps(viewer, !ready || running)} onClick={apply}>{running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{running ? 'Saving…' : `Apply as version ${next}`}</button></span>}
      {typeof onNav.openPrompt === 'function' && data.promptId && <NavButton icon={ScrollText} label="Open in Prompts" onClick={() => onNav.openPrompt(data.promptId)} />}
    </div>
    {!status && ready && <p className="reply-muted">Free. Runs already going keep the version they started with, and History in Prompts can restore the one before.</p>}
  </CardShell>;
}

// What a card's own request came to, recorded on its reply action (help-assistant records it with the conversation): a
// string is done, false is "they said no" (cancelled, the button comes back), and a throw is a failure with its reason.
async function settle(work, index, onOutcome, setLocal) {
  setLocal({ status: 'running' });
  try {
    const result = await work();
    const outcome = result === false ? { status: 'cancelled', text: '' } : { status: 'done', text: typeof result === 'string' ? result : 'Done.' };
    setLocal(outcome.status === 'done' ? outcome : null);
    if (index != null) onOutcome?.(index, outcome);
    return outcome;
  } catch (failure) {
    const outcome = { status: 'failed', text: messageOf(failure) };
    setLocal(outcome); if (index != null) onOutcome?.(index, outcome);
    return outcome;
  }
}
const channelsOf = (state) => { const studio = studioOf(state); const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId); return routingChannels(workspace?.editionId || 'general'); };
// "Note: For Social first · Channels: Social, Blog": what a button will save, in words, from its checked params.
export function paramsLine(params = {}, channels = []) {
  const name = (id) => channels.find((row) => row.id === id)?.short || channels.find((row) => row.id === id)?.name || id;
  const words = { note: 'Note', channels: 'Channels', channel: 'Channel', status: 'Status', link: 'Link', date: 'Planned', trends: 'Trends', emails: 'People', role: 'Role', topic: 'Topic', name: 'Name', days: 'Days back' };
  return Object.entries(params || {}).filter(([key, value]) => words[key] && (Array.isArray(value) ? value.length : value !== '' && value != null)).map(([key, value]) => `${words[key]}: ${Array.isArray(value) ? value.map((item) => (key.startsWith('channel') ? name(item) : item)).join(', ') : key.startsWith('channel') ? name(value) : key === 'status' ? sentence(value) : text(value)}`).join(' · ');
}

// Action form: what Ask AI filled in for a button (a note and channels for a Yes, a channel, link and planned date for
// "using it", a status and live link), as fields the person changes before anything is saved. The button runs the same
// action through the shared runner with the edited params; nothing is saved until it is pressed.
export function ActionFormCard({ card, actions, actionState, onRunAction, onOutcome, state }) {
  const viewer = useViewer(); const formId = useId(); const pick = usePrimary();
  const data = card.data || {}; const index = list(card.actionIndexes)[0];
  const offered = Number.isInteger(index) ? actions[index] : null;
  const fields = list(data.fields).filter((field) => field?.key);
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.key, field.type === 'channels' ? list(field.value) : text(field.value)])));
  const [local, setLocal] = useState(null);
  const status = local || (index != null ? actionState[index] : null);
  const channels = channelsOf(state);
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  if (!offered) return null;
  if (status?.status === 'done') return <p className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</p>;
  const running = status?.status === 'running';
  async function save(event) {
    event.preventDefault();
    if (running || !onRunAction) return;
    const params = { ...(offered.params || {}) };
    for (const field of fields) {
      const value = values[field.key];
      if (field.type === 'channels' ? list(value).length : String(value ?? '').trim()) params[field.key] = field.type === 'channels' ? list(value) : String(value).trim();
      else delete params[field.key];
    }
    await settle(() => onRunAction({ ...offered, params }), index, onOutcome, setLocal);
  }
  const missing = (offered.kind === 'mark-used' && !values.channel) || (offered.kind === 'set-status' && !values.status);
  const field = (row) => {
    const id = `${formId}-${row.key}`; const value = values[row.key];
    if (row.type === 'channels') {
      const picked = list(value); const options = list(row.options).length ? row.options : channels.map((channel) => ({ value: channel.id, label: channel.name }));
      return <fieldset key={row.key} className="cc-toggles"><legend>{row.label}</legend>
        <label className={!picked.length ? 'is-on' : ''}><input type="checkbox" checked={!picked.length} onChange={() => set(row.key, [])} /><span>All channels</span></label>
        {options.map((option) => { const on = picked.includes(option.value); return <label key={option.value} className={on ? 'is-on' : ''}><input type="checkbox" checked={on} onChange={() => set(row.key, on ? picked.filter((item) => item !== option.value) : [...picked, option.value])} /><span>{option.label}</span></label>; })}
      </fieldset>;
    }
    if (row.type === 'channel' || row.type === 'enum') {
      const options = list(row.options).length ? row.options : channels.map((channel) => ({ value: channel.id, label: channel.name }));
      return <label key={row.key} className="cc-field" htmlFor={id}><span>{row.label}</span><select id={id} value={value} onChange={(event) => set(row.key, event.target.value)}>{row.type === 'channel' && <option value="">Choose a channel</option>}{row.type === 'enum' && !value && <option value="">Choose one</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
    }
    if (row.type === 'text') {
      const max = Number(row.max) || 280;
      return <label key={row.key} className="cc-field" htmlFor={id}><span>{row.label}<small className="reply-muted">{String(value || '').length} / {max}</small></span><textarea id={id} rows={2} maxLength={max} value={value} onChange={(event) => set(row.key, event.target.value)} /></label>;
    }
    if (row.key === 'link' && offered.kind === 'set-status' && values.status !== 'published') return null;
    return <label key={row.key} className="cc-field" htmlFor={id}><span>{row.label}</span><input id={id} type={row.type === 'date' ? 'date' : row.type === 'url' ? 'url' : 'text'} inputMode={row.type === 'url' ? 'url' : undefined} placeholder={row.type === 'url' ? 'https://' : undefined} value={value} onChange={(event) => set(row.key, event.target.value)} /></label>;
  };
  return <CardShell type="action" kicker="Check before saving" title={data.title || card.title} icon={ListChecks} note={card.note}>
    <form className="cc-plan" onSubmit={save}>
      {fields.map(field)}
      {list(data.problems).length > 0 && <ul className="cc-warnings">{list(data.problems).map((line) => <li key={line}><TriangleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
      {status?.status === 'failed' && <p className="reply-failed" role="alert">{status.text}</p>}
      <div className="reply-card-foot">
        <button type="submit" className={pick(true)} {...writeProps(viewer, running || missing || !onRunAction)}>{running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{running ? 'Saving…' : card.title || 'Save'}</button>
        <small className="reply-muted">{data.spends ? 'You’ll see the cost before anything is spent.' : 'Free. Nothing is saved until you press it.'}</small>
      </div>
    </form>
  </CardShell>;
}

// The answers a choice card shows, none of them reading the same: the same item (or the same words, for a question)
// once, and answers that still read alike (a conversation saved before the server told them apart) numbered.
// Two lines read the same when they match with case and spacing aside (the server's help-assistant.js sameText).
const sameText = (value) => text(value).trim().toLowerCase().replace(/\s+/g, ' ');
export function choiceOptions(options, { pick = false } = {}) {
  const seen = new Set(); const rows = [];
  for (const row of list(options)) {
    if (!row?.label) continue;
    const key = pick ? JSON.stringify(Object.entries(row.ids || {}).sort(([a], [b]) => a.localeCompare(b))) : sameText(row.label);
    if (seen.has(key)) continue; seen.add(key); rows.push({ ...row });
    if (rows.length >= 5) break;
  }
  const reads = (row) => `${sameText(row.label)}\n${sameText(row.detail)}`;
  const groups = new Map(); for (const row of rows) groups.set(reads(row), [...(groups.get(reads(row)) || []), row]);
  for (const group of groups.values()) if (group.length > 1) group.forEach((row, at) => { row.detail = [text(row.detail).trim(), `${at + 1} of ${group.length}`].filter(Boolean).join(' · '); });
  return rows;
}
// Up, Down, Home and End move between the answers (Tab and Enter work as usual).
function moveBetween(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]; if (!rows.length) return;
  const at = rows.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : event.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
  event.preventDefault(); rows[next].focus();
}
// Choice: a question with a few answers. Picking one either sends its follow-up question (onAsk), or, when the server
// found two things a button could mean (data.pick), runs that button on the one picked, with no AI call.
export function ChoiceCard({ card, actions, actionState, onRunAction, onOutcome, onAsk }) {
  const viewer = useViewer();
  const data = card.data || {}; const index = list(card.actionIndexes)[0];
  const offered = data.pick && Number.isInteger(index) ? actions[index] : null;
  const options = choiceOptions(data.options, { pick: Boolean(data.pick) });
  const [local, setLocal] = useState(null);
  const [chosen, setChosen] = useState(-1); // the row picked: its question was asked, or its button is running
  const status = local || (offered && index != null ? actionState[index] : null);
  if (!options.length || (data.pick && !offered)) return null;
  if (status?.status === 'done') return <p className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</p>;
  const running = status?.status === 'running';
  const asked = !offered && chosen >= 0;
  // The row picked stays marked (and says so to screen readers) while its question is asked or its button runs.
  const picked = (at) => chosen === at && (offered ? running : true);
  function choose(option, at) {
    if (offered) { if (onRunAction && !running) { setChosen(at); const { candidates, ...rest } = offered; settle(() => onRunAction({ ...rest, ...(option.ids || {}), title: option.label }), index, onOutcome, setLocal); } return; }
    if (!onAsk || asked) return;
    setChosen(at); onAsk(option.question || option.label);
  }
  return <CardShell type="choice" kicker={offered ? offered.label : 'A quick question'} title={card.title} icon={HelpCircle} note={card.note}>
    <div className="reply-choices" role="group" aria-label={card.title} onKeyDown={moveBetween}>
      {options.map((option, at) => <button key={at} type="button" className={`reply-choice${picked(at) ? ' is-on' : ''}`} aria-current={picked(at) ? 'true' : undefined} {...writeProps(viewer, running || asked || (offered ? !onRunAction : !onAsk))} onClick={() => choose(option, at)}><span className="reply-choice-text"><span className="reply-choice-title">{option.label}</span>{option.detail && <small className="reply-choice-detail">{option.detail}</small>}</span><ChevronRight size={16} aria-hidden="true" /></button>)}
    </div>
    {running && <p className="reply-muted" role="status"><LoaderCircle className="spin" size={12} aria-hidden="true" />Working on it…</p>}
    {status?.status === 'failed' && <p className="reply-failed" role="alert">{status.text}</p>}
  </CardShell>;
}

// Plan: steps the person runs one at a time, in order, each with its own button (paid steps still confirm their own
// estimate). A step opens once every earlier one is done or skipped; a failed step stops the plan until it's tried
// again. Outcomes are recorded per button, so a reopened conversation picks up where it stopped.
export function PlanCard({ card, actions, actionState, onAction, onOutcome, state }) {
  const viewer = useViewer(); const pick = usePrimary();
  const steps = list(card.data?.steps).filter((step) => Number.isInteger(step?.index) && actions[step.index]);
  const channels = channelsOf(state);
  if (steps.length < 2) return null;
  const stateOf = (step) => actionState[step.index];
  const settled = (step) => planSettled(stateOf(step));
  const current = steps.findIndex((step) => !settled(step));
  const finished = current < 0;
  return <CardShell type="plan" kicker={finished ? 'Plan done' : `Step ${current + 1} of ${steps.length}`} title={card.title || 'Plan'} icon={ListOrdered} note={card.note}>
    <ol className="cc-steps">{steps.map((step, at) => {
      const row = actions[step.index]; const status = stateOf(step); const open = at === current; const done = settled(step);
      const details = paramsLine(row.params, channels);
      return <li key={step.index} className={done ? 'is-done' : open ? 'is-current' : 'is-later'}>
        <span className="cc-step-mark" aria-hidden="true">{done ? <Check size={12} /> : at + 1}</span>
        <div className="cc-step-body">
          <strong>{row.label}</strong>
          {step.why && <small>{step.why}</small>}
          {details && <small className="reply-muted">{details}</small>}
          {status?.status === 'done' && <span className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>}
          {status?.status === 'skipped' || (status?.status === 'cancelled' && status.text) ? <small className="reply-muted">Skipped</small> : null}
          {status?.status === 'failed' && <small className="reply-failed" role="alert">{status.text}</small>}
          {open && onAction && <div className="reply-card-foot">
            <button type="button" className={pick(true)} {...writeProps(viewer, status?.status === 'running')} onClick={() => onAction(step.index)}>{status?.status === 'running' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : status?.status === 'failed' ? <RotateCcw size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}{status?.status === 'failed' ? 'Try again' : row.label}</button>
            <button type="button" className="reply-text-button" disabled={status?.status === 'running'} onClick={() => onOutcome?.(step.index, { status: 'cancelled', text: 'Skipped.' })}><SkipForward size={12} aria-hidden="true" />Skip</button>
          </div>}
        </div>
      </li>;
    })}</ol>
  </CardShell>;
}

// Draft: a Slack update, email or post Ask AI wrote, editable here (nothing is saved or sent), with Copy, Copy for
// Slack and a request for a shorter one.
const DRAFT_KIND = { slack: 'Slack message', email: 'Email', linkedin: 'LinkedIn post', x: 'X post', note: 'Note' };
// Slack's own Markdown: *bold*, • bullets and <url|label> links.
export const forSlack = (value) => text(value).split('\n').map((line) => line.replace(/^(\s*)[-*+]\s+/, '$1• ').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '*$1*').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>').replace(/^#{1,6}\s+(.+)$/, '*$1*')).join('\n');
export function DraftCard({ card, onAsk }) {
  const viewer = useViewer(); const id = useId(); const pick = usePrimary();
  const data = card.data || {}; const kind = DRAFT_KIND[data.kind] ? data.kind : 'note';
  const [value, setValue] = useState(text(data.text));
  const [note, setNote] = useState('');
  if (!text(data.text).trim()) return null;
  async function copy(slack) {
    const done = await copyText(slack ? forSlack(value) : value);
    setNote(done ? (slack ? 'Copied for Slack.' : 'Copied.') : 'This window blocked copying. Select the text and copy it yourself.');
  }
  return <CardShell type="draft" kicker={`Draft · ${DRAFT_KIND[kind]}`} title={data.subject || card.title || DRAFT_KIND[kind]} icon={PenLine} note={card.note}>
    <label className="cc-sr-only" htmlFor={id}>Draft text</label>
    <textarea id={id} className="cc-draft" rows={Math.min(12, Math.max(4, value.split('\n').length + 1))} value={value} onChange={(event) => { setValue(event.target.value); setNote(''); }} />
    <div className="reply-card-foot">
      <button type="button" className={pick(true)} onClick={() => copy(false)}><Copy size={14} aria-hidden="true" />Copy</button>
      {kind === 'slack' || kind === 'note' ? <button type="button" className={BUTTON.quiet} onClick={() => copy(true)}><Copy size={14} aria-hidden="true" />Copy for Slack</button> : null}
      {onAsk && <button type="button" className={BUTTON.quiet} {...writeProps(viewer)} onClick={() => onAsk(`Make the ${DRAFT_KIND[kind].toLowerCase()} draft${data.subject ? ` “${data.subject}”` : ''} shorter.`)}><Sparkles size={13} aria-hidden="true" />Ask for a shorter one</button>}
      <small className="reply-muted" role="status">{note || 'Not sent. Copy it and send it yourself.'}</small>
    </div>
  </CardShell>;
}

// Report change: Ask AI's new text for one section of a report it read, line by line, with the brand check on the new
// lines. Apply saves the whole report through editStudioAsset with the edit it was based on, so a save someone made in
// between is refused (and says who) instead of being overwritten. Open the report opens it in the reader instead.
export function ReportChangeCard({ card, actions, actionState, onOutcome, onNav, api, state }) {
  const can = useCan(); const viewer = useViewer(); const pick = usePrimary();
  const data = card.data || {}; const index = reportActionIndex(card, actions);
  const [local, setLocal] = useState(null);
  const status = local || (index >= 0 ? actionState[index] : null);
  const running = status?.status === 'running';
  const lines = list(data.diff); const counts = finite(data.added) ? { added: Number(data.added), removed: Number(data.removed) || 0 } : diffCounts(lines);
  const problems = list(data.problems).map(text).filter(Boolean);
  const studio = studioOf(state);
  const live = list(studio.assets).find((row) => row.id === data.assetId);
  const newer = live && text(live.edited?.at) !== text(data.baseEditedAt) && status?.status !== 'done' ? live.edited || live.restored || {} : null;
  const workspace = list(studio.workspaces).find((row) => row.id === studio.activeWorkspaceId);
  const findings = useMemo(() => { const brand = brandFrom(workspace); return checkBrand(lines.filter((line) => line.op === 'add').map((line) => line.text).join('\n'), { claimsToAvoid: brand.claimsToAvoid, editionId: brand.editionId }); }, [data.diff, workspace?.id]);
  const canSave = typeof api?.editStudioAsset === 'function' && can('editStudioAsset');
  const ready = Boolean(data.canApply) && canSave && !newer && Boolean(data.assetId && typeof data.markdown === 'string');
  async function apply() {
    if (!ready || running) return;
    await settle(async () => { await api.editStudioAsset({ assetId: data.assetId, markdown: data.markdown, baseEditedAt: text(data.baseEditedAt) }); return `Saved the new “${data.section}” in “${data.title}”.`; }, index >= 0 ? index : null, onOutcome, setLocal);
  }
  return <CardShell type="report-change" kicker="Suggested report change" title={card.title || data.title || 'Report'} icon={PenLine} note={card.note}>
    <p className="reply-muted">{[data.section && `Section: ${data.section}`, `${plural(counts.added, 'line')} added`, `${plural(counts.removed, 'line')} removed`].filter(Boolean).join(' · ')}</p>
    {data.note && <p className="reply-body">{data.note}</p>}
    <PromptDiff lines={lines} label={`Changes to ${data.section || 'the report'}`} className="cc-diff" />
    {finite(data.diffShortened) && <p className="reply-muted">Showing the first {plural(lines.length, 'line')} of {Number(data.diffShortened)}. Open the report to see the rest.</p>}
    {findings.length > 0 && <details className="cc-targets"><summary>Brand check · {checkSummary(findings)}<ChevronDown size={13} aria-hidden="true" /></summary><ul className="cc-warnings">{findings.slice(0, 5).map((row) => <li key={row.id}><Info size={13} aria-hidden="true" />{row.message}</li>)}</ul></details>}
    {problems.length > 0 && <ul className="cc-warnings" aria-label="Why it can’t be applied yet">{problems.map((line) => <li key={line}><TriangleAlert size={13} aria-hidden="true" />{line}</li>)}</ul>}
    {newer && <p className="reply-note" role="status"><Info size={13} aria-hidden="true" />{newer.by?.name || 'Someone'} changed this report after the suggestion. Ask again for one based on it, or open the report.</p>}
    {data.canApply && !canSave && <p className="reply-muted">Your role can read reports but not edit them.</p>}
    {status?.status === 'failed' && <p className="reply-failed" role="alert">{status.text}</p>}
    <div className="reply-card-foot">
      {status?.status === 'done'
        ? <span className="reply-done" role="status"><Check size={14} aria-hidden="true" />{status.text}</span>
        : data.canApply && canSave && <span className="reply-action"><button type="button" className={pick(true)} {...writeProps(viewer, !ready || running)} onClick={apply}>{running ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{running ? 'Saving…' : 'Apply'}</button></span>}
      {typeof onNav.openReport === 'function' && data.assetId && <NavButton icon={FileText} label="Open the report" onClick={() => onNav.openReport(data.assetId)} />}
    </div>
    {!status && ready && <p className="reply-muted">Free. Everything made from the report afterwards uses the new text, and Restore the original undoes all edits.</p>}
  </CardShell>;
}

const RENDERERS = { trend: TrendCard, report: ReportCard, 'asset-folder': AssetFolderCard, run: RunCard, program: ProgramCard, metric: MetricCard, chart: ChartCard, table: TableCard, checklist: ChecklistCard, compare: CompareCard, posts: PostsCard, 'scan-plan': ScanPlanCard, 'prompt-change': PromptChangeCard, 'report-change': ReportChangeCard, action: ActionFormCard, choice: ChoiceCard, plan: PlanCard, draft: DraftCard, memory: MemoryCard };
export const CARD_TYPES = Object.keys(RENDERERS);
