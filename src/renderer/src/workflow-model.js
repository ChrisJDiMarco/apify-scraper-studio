// Workflows and playbooks, in words: pure, renderer-side (ESM). The main process decides (src/shared/workflow-core.js
// validateWorkflow); this mirrors the grammar for instant feedback and writes the sentences the pages show.
import CATALOG from '../../shared/workflow-steps.json';
import KIT from '../../shared/kit-folders.json';
import { CODEX_UNCAPPED, money } from './studio-actions.js';

const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const STEP_CATALOG = CATALOG;
export const stepLabel = (kind) => CATALOG.steps[kind]?.label || kind;
export const stepIcon = (kind) => CATALOG.steps[kind]?.icon || 'Circle';
export const stepSpends = (kind) => Boolean(CATALOG.steps[kind]?.spends);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PLATFORM = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };

// "A, B and C" / "A or B".
export function joinWords(words, last = 'and') {
  const items = list(words).filter(Boolean);
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`;
}
function clock(time = '09:00') {
  const [hour, minute] = String(time).split(':').map(Number);
  if (!Number.isFinite(hour)) return String(time);
  return `${hour}:${String(minute || 0).padStart(2, '0')}`;
}
// "America/New_York" → "New York"; UTC stays UTC.
export function zoneName(timeZone = 'UTC') { return String(timeZone || 'UTC').split('/').at(-1).replace(/_/g, ' '); }
function shortDay(day) { const date = new Date(`${day}T12:00:00Z`); return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : day; }
const programName = (programs, programId) => list(programs).find((program) => program.id === programId)?.name || 'the program';
// Channel names for this edition.
export function channelNames(ids, edition = 'general') {
  const editionId = edition === 'semrush' ? 'semrush' : 'general';
  return list(ids).map((id) => list(KIT.folders).find((folder) => folder.id === id)?.[editionId] || id);
}

// "Every Monday at 8:00 (New York)", "Whenever “SEO weekly” runs", "Every 6 hours until Oct 24", "Only when someone
// starts it". On the Mac, a schedule adds "while the studio is open".
export function describeTrigger(trigger = {}, programs = [], { desktop = false } = {}) {
  const open = desktop ? ', while the studio is open' : '';
  if (trigger.kind === 'program-run') return `Whenever “${programName(programs, trigger.programId)}” runs`;
  if (trigger.kind !== 'schedule') return 'Only when someone starts it';
  const s = trigger.schedule || {}; const at = `at ${clock(s.time)} (${zoneName(s.timeZone)})`;
  if (s.frequency === 'hourly') return `Every ${s.everyHours === 1 ? 'hour' : `${s.everyHours} hours`} until ${shortDay(s.until)}${open}`;
  if (s.frequency === 'daily') return `Every day ${at}${open}`;
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS[s.weekday ?? 1]} ${at}${open}`;
  if (s.frequency === 'monthly') return `Monthly on day ${s.dayOfMonth || 1} ${at}${open}`;
  return 'Only when someone starts it';
}

function ruleWords(rule) {
  const parts = [];
  if (list(rule.momentum).length) parts.push(joinWords(rule.momentum.map((id) => CATALOG.momentum[id]), 'or'));
  if (list(rule.velocity).length) parts.push(`speed ${joinWords(rule.velocity.map((id) => CATALOG.velocity[id]), 'or')}`);
  if (list(rule.priority).length) parts.push(joinWords(rule.priority.map((id) => CATALOG.priority[id]), 'or'));
  if (rule.minPosts) parts.push(`at least ${plural(rule.minPosts, 'post')}`);
  if (rule.minPlatforms) parts.push(`on ${rule.minPlatforms}+ platforms`);
  return parts.join(' and ');
}
const waitWords = (hours) => (hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour'));

// One sentence per step, for the step rail and the setup preview.
export function describeStep(step = {}, { programs = [], edition = 'general', monday = null, imagesReady = true } = {}) {
  switch (step.kind) {
    case 'research': {
      const program = list(programs).find((row) => row.id === step.programId);
      const platforms = [...new Set(list(program?.sourceGroups).filter((group) => group.enabled !== false).map((group) => PLATFORM[group.platform] || group.platform))];
      const days = program?.lookbackDays || 7;
      return `Find trends with “${program?.name || 'the program'}” (last ${plural(days, 'day')}${platforms.length ? ` · ${platforms.join(', ')}` : ''})`;
    }
    case 'quick-scan': return `Quick scan for “${step.scan?.topic || 'a topic'}” over the last ${plural(step.scan?.lookbackHours || 12, 'hour')}, with a short trends report.`;
    case 'approve': {
      const after = step.afterWait === 'stop' ? 'then stop' : 'then the rest are skipped';
      const wait = `Others wait for someone’s OK for ${waitWords(step.waitHours || 48)}, ${after}.`;
      if (step.mode === 'all') return 'Say yes to every trend found.';
      if (step.mode === 'review') return `Wait for someone’s OK for ${waitWords(step.waitHours || 48)}, ${after}.`;
      const rules = list(step.rules).map(ruleWords).filter(Boolean);
      const what = rules.length ? `that are ${rules.join(', or ')}` : 'that meet the rules';
      return `Say yes to up to ${plural(step.maxApprove || 3, 'trend')} ${what}. ${step.otherwise === 'skip' ? 'The rest are skipped.' : wait}`;
    }
    case 'reports': return 'Write a trends report and editorial toolkit for each approved trend.';
    case 'assets': {
      const names = channelNames(step.channels, edition);
      const pictures = step.pictures === false ? 'pictures off' : imagesReady ? 'pictures on' : 'pictures off for your team';
      return `Make ${joinWords(names) || 'channel'} assets for each report (${pictures}).`;
    }
    case 'monday': {
      const board = monday?.link?.boardName;
      if (!monday?.connected || !board) return `Update Monday.com${step.alsoAtReview ? ', also when trends need review' : ''} (not connected yet).`;
      return `Update “${board}” on Monday.com${step.alsoAtReview ? ', also when trends need review' : ''}.`;
    }
    case 'notify': {
      const who = list(step.audience).map((id) => ({ admin: 'admins', editor: 'editors' })[id]).filter(Boolean);
      return `Tell ${joinWords(who) || 'the team'} in their Inbox.`;
    }
    default: return stepLabel(step.kind);
  }
}

// The step kinds that may be added after position `index` (0-based), in order, each at most once.
export function allowedNext(steps = [], index = steps.length - 1) {
  const source = steps[0]?.kind;
  if (!source) return ['research', 'quick-scan'];
  const order = source === 'quick-scan' ? CATALOG.afterQuickScan : CATALOG.afterResearch;
  const used = new Set(steps.map((step) => step.kind));
  const before = steps.slice(1, index + 1).map((step) => order.indexOf(step.kind)).filter((at) => at >= 0);
  const after = steps.slice(index + 1).map((step) => order.indexOf(step.kind)).filter((at) => at >= 0);
  const low = before.length ? Math.max(...before) : -1; const high = after.length ? Math.min(...after) : order.length;
  return order.filter((kind, at) => at > low && at < high && !used.has(kind) && (kind !== 'assets' || used.has('reports') || steps.slice(0, index + 1).some((step) => step.kind === 'reports')));
}

// The same grammar as the server, as { field, message } problems (empty when the draft can be saved).
export function validateDraft(workflow = {}, { programs = [] } = {}) {
  const problems = [];
  const steps = list(workflow.steps);
  if (!String(workflow.name || '').trim()) problems.push({ field: 'name', message: 'Name this workflow.' });
  if (String(workflow.name || '').length > CATALOG.limits.nameChars) problems.push({ field: 'name', message: `Keep the name under ${CATALOG.limits.nameChars} characters.` });
  if (!steps.length) { problems.push({ field: 'steps', message: 'Add the first step: find trends or run a quick scan.' }); return problems; }
  if (steps.length > CATALOG.limits.steps) problems.push({ field: 'steps', message: `Use up to ${CATALOG.limits.steps} steps.` });
  const source = steps[0].kind;
  if (!CATALOG.steps[source]?.source) problems.push({ field: 'steps.0.kind', message: 'The first step finds trends or runs a quick scan.' });
  if (!steps[0].programId) problems.push({ field: 'steps.0.programId', message: source === 'quick-scan' ? 'Choose the program whose accounts the quick scan reads.' : 'Choose a research program.' });
  const program = list(programs).find((row) => row.id === steps[0].programId);
  if (source === 'research' && steps[1]?.kind !== 'approve') problems.push({ field: 'steps.1.kind', message: 'After finding trends, add “Approve trends”.' });
  if (source === 'quick-scan' && steps.slice(1).some((step) => step.kind !== 'notify')) problems.push({ field: 'steps', message: 'After a quick scan the only step is telling the team.' });
  if (steps.some((step) => step.kind === 'assets') && !steps.some((step) => step.kind === 'reports')) problems.push({ field: 'steps', message: 'Channel assets are made from reports. Add “Write reports” first.' });
  steps.forEach((step, index) => {
    if (step.kind === 'approve' && step.mode === 'rules' && !list(step.rules).length) problems.push({ field: `steps.${index}.rules`, message: 'Add at least one rule, or choose to wait for someone’s OK.' });
    if (step.kind === 'approve' && program?.autoApproveThemes && step.mode !== 'all') problems.push({ field: `steps.${index}.mode`, message: 'This program approves every trend itself. Turn that off in the program to use rules.' });
    if (step.kind === 'assets' && !list(step.channels).length) problems.push({ field: `steps.${index}.channels`, message: 'Choose at least one channel.' });
    if (step.kind === 'quick-scan' && !String(step.scan?.topic || '').trim()) problems.push({ field: `steps.${index}.scan.topic`, message: 'Name a topic to scan for.' });
  });
  const trigger = workflow.trigger || {};
  if (trigger.kind === 'schedule' && trigger.schedule?.frequency === 'hourly' && source !== 'quick-scan') problems.push({ field: 'trigger', message: 'Only quick scans can run every few hours.' });
  if (trigger.kind === 'schedule' && source === 'research' && program?.schedule?.enabled) problems.push({ field: 'trigger', message: `“${program.name}” already runs on its own schedule. Turn that off in the program, or choose “Whenever “${program.name}” runs”.` });
  if (trigger.kind === 'program-run' && trigger.programId !== steps[0].programId) problems.push({ field: 'trigger', message: 'A workflow that starts when a program runs finds trends with that same program.' });
  return problems;
}

const STEP_WORDS = { research: 'Finding trends', 'quick-scan': 'Running a quick scan', approve: 'Approving trends', reports: 'Writing reports', assets: 'Making channel assets', monday: 'Updating Monday.com', notify: 'Telling the team' };
// One line for a run: "Running · Writing reports", "Waiting for your OK on 2 trends", "Waiting: needs a bigger budget",
// "Done · 3 trends, 3 reports, 9 assets", "Stopped at Make channel assets".
export function runLine(run = {}, { assets = null } = {}) {
  const steps = list(run.steps);
  const current = steps.find((step) => step.stepId === run.currentStepId) || steps.find((step) => ['running', 'waiting'].includes(step.status));
  if (run.status === 'running') return `Running · ${STEP_WORDS[current?.kind] || 'Starting'}`;
  if (run.status === 'waiting-review') return `Waiting for your OK on ${plural(run.waiting?.count || 0, 'trend')}`;
  if (run.status === 'waiting-budget') return 'Waiting: needs a bigger budget';
  if (run.status === 'skipped') return `Skipped · ${run.message || 'it couldn’t start'}`;
  if (run.status === 'cancelled') return 'Stopped';
  const failedStep = steps.find((step) => step.status === 'failed');
  if (run.status === 'failed' || (run.status === 'partial' && failedStep)) return `Stopped at ${stepLabel(failedStep?.kind || current?.kind)}`;
  const counts = runCounts(run);
  if (counts.scan !== null) return counts.scan ? `Done · ${plural(counts.scan, 'trend')} found` : 'Done · no new trends';
  const parts = [counts.trends && plural(counts.trends, 'trend'), counts.reports && plural(counts.reports, 'report'), (assets ?? counts.sets) && plural(assets ?? counts.sets, assets === null ? 'asset set' : 'asset')].filter(Boolean);
  if (run.status === 'partial') return parts.length ? `Partly done · ${parts.join(', ')}` : 'Partly done';
  return parts.length ? `Done · ${parts.join(', ')}` : `Done · ${run.message || 'nothing new'}`;
}
export function runCounts(run = {}) {
  const steps = list(run.steps); const of = (kind) => steps.find((step) => step.kind === kind)?.refs || {};
  const approve = of('approve');
  return {
    trends: list(approve.approved).length + list(approve.decidedByPeople).length,
    byRule: list(approve.approved).length, byPeople: list(approve.decidedByPeople).length,
    reports: list(of('reports').reportRuns).length,
    sets: list(of('assets').kitRuns).filter((entry) => entry.contentRunId).length,
    scan: steps.some((step) => step.kind === 'quick-scan') ? list(of('quick-scan').trends).length : null,
  };
}

// The step each run reached, for the rail in run mode: { [stepId]: status }.
export const runStates = (run) => Object.fromEntries(list(run?.steps).map((step) => [step.stepId, step.status]));
export const STATUS_WORDS = { pending: 'Not started', running: 'Running', waiting: 'Waiting', done: 'Done', partial: 'Partly done', skipped: 'Skipped', failed: 'Stopped' };

// The money lines under a workflow's estimate (BudgetDialog, Run now, setup review). A viewer without See costs never
// gets here: the server strips the amounts and the pages don't call this.
export function budgetLines(estimate = {}) {
  const lines = [];
  const run = estimate.perRun || {};
  if (run.capUsd || run.aboutUsd) lines.push(`Each run: about ${money(run.aboutUsd)}, never more than ${money(run.capUsd)}.`);
  const month = estimate.perMonth;
  if (month) {
    const runs = month.runs?.min === month.runs?.max ? plural(month.runs.max, 'run') : `${month.runs.min}–${month.runs.max} runs`;
    lines.push(`Each month: about ${money(month.aboutUsd)} for ${runs}, never more than ${money(month.capUsd)}.`);
  }
  lines.push('It stops and asks if a run would go over.');
  if (estimate.uncapped) lines.push(CODEX_UNCAPPED);
  return lines;
}
// Rounded-up dollars, the default budget fields.
export const roundUp = (value) => Math.max(1, Math.ceil(Number(value) || 0));

// A blank workflow for the editor.
export function blankWorkflow(programId = '') {
  return { name: '', description: '', trigger: { kind: 'manual' }, steps: [{ kind: 'research', programId }, { kind: 'approve', mode: 'review', rules: [], maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'stop', channels: [], note: '' }] };
}
// A new step of a kind, with its defaults.
export function newStep(kind, { programId = '', focus = [] } = {}) {
  switch (kind) {
    case 'research': return { kind, programId };
    case 'quick-scan': return { kind, programId, scan: { topic: '', depth: 'lite', platforms: [], lookbackHours: 12 } };
    case 'approve': return { kind, mode: 'rules', rules: [{ momentum: ['rising', 'new'], priority: ['FAST-TRACK', 'STRONG'] }], maxApprove: 3, otherwise: 'review', waitHours: 48, afterWait: 'continue', channels: [], note: '' };
    case 'assets': return { kind, channels: list(focus).length ? [...focus] : ['blog', 'newsletter', 'social'], pictures: true, teamNotes: '' };
    case 'monday': return { kind, alsoAtReview: false };
    case 'notify': return { kind, audience: ['admin', 'editor'], slackSummary: false };
    default: return { kind };
  }
}

// Status pill for a workflow row.
export function workflowStatus(workflow = {}) {
  if (workflow.status === 'active' && !workflow.needsBudget) return { id: 'on', label: 'On', tone: 'done' };
  if (workflow.status === 'paused') return { id: 'paused', label: 'Paused', tone: 'warn' };
  if (workflow.needsBudget && (workflow.budget || workflow.approvalRequested)) return { id: 'budget', label: 'Needs budget approval', tone: 'warn' };
  return { id: 'draft', label: 'Draft', tone: 'plain' };
}

// "Copy summary for Slack": a plain-text summary of a finished run.
export function slackSummary(run = {}, workflow = {}) {
  const counts = runCounts(run);
  const lines = [`*${workflow.name || run.workflowName || 'Workflow'}* · ${runLine(run)}`];
  const approved = run.steps?.find((step) => step.kind === 'approve')?.refs?.approved || [];
  for (const row of approved) lines.push(`• ${row.name} (${row.reason})`);
  if (counts.scan !== null) for (const name of run.steps.find((step) => step.kind === 'quick-scan')?.refs?.trends || []) lines.push(`• ${name}`);
  return lines.join('\n');
}
