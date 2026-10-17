// The words every paid confirmation uses outside the Ask AI adapter (studio-actions.js): the Advanced run panel and
// Trend board, and Simple's Finish the rest. Pure and async-only (no hooks), so a panel that keeps its own payload
// (RunDetail's edited trend names, Advanced's "Use saved collections") still asks with the same estimate and the same
// sentences as Simple and Ask AI. The research lines are studio-actions' researchCostLinesFrom and the retry room its
// retryCap; reportCostLine matches the hook's reportCostLines word for word (keep the two in step).
import { CODEX_UNCAPPED, money, newestPromptsLine, researchCostLinesFrom, retryCap as sharedRetryCap, spendLine } from './studio-actions.js';
import { number } from './ui.jsx';

const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;

async function estimateOf(api, program) {
  if (!program || typeof api?.estimateResearchProgram !== 'function') return null;
  try { return await api.estimateResearchProgram({ ...program, sourceGroups: list(program.sourceGroups).map((group) => ({ ...group, targets: list(group.targets) })) }); } catch { return null; }
}

// What starting a research run costs: finding trends (everything when reports are written without a review), against
// the program's caps. `datasetIds` (Advanced's "Use saved collections") reads saved posts, so nothing goes to Apify.
export async function researchCostLines(api, program, { datasetIds = [], codex = false } = {}) {
  const budgets = program?.budgets || {};
  const reuse = list(datasetIds).length > 0;
  const estimate = await estimateOf(api, program);
  if (!reuse) return researchCostLinesFrom(estimate, program || {}, { codex });
  const stages = estimate?.ai?.stages || {};
  const finding = ['discovery', 'synthesis', 'matching'].reduce((sum, key) => sum + (Number(stages[key]) || 0), 0);
  const aiUsd = !estimate?.ai ? null : program.autoApproveThemes ? estimate.ai.totalUsd : Math.round(finding * 100) / 100;
  // Reading saved collections: the same AI line, and nothing on Apify.
  return [
    spendLine({ aiUsd, aiCapUsd: budgets.aiUsd }),
    'Nothing is collected on Apify; it reads the saved collections.',
    !estimate ? 'The estimate isn’t available right now, so this is the program’s AI cap.' : '',
    estimate && !program.autoApproveThemes ? 'Writing reports for the trends you approve is confirmed separately.' : '',
    codex ? CODEX_UNCAPPED : '',
  ].filter(Boolean);
}

// One run's line for Write reports: tagging plus each report from the program's estimate, against what is left of the
// run's AI budget. `label` prefixes the line when several runs are confirmed together.
export async function reportCostLine({ api, run, program, count, label = '' }) {
  const cap = Number(run?.maxBudgetUsd); const spent = Number(run?.ownCostUsd ?? run?.costUsd) || 0;
  const estimate = await estimateOf(api, program);
  const stages = estimate?.ai?.stages;
  const perReport = stages && program?.maxThemes ? (Number(stages.reports) || 0) / program.maxThemes : null;
  const aiUsd = perReport == null ? null : Math.round(((Number(stages.tagging) || 0) + perReport * count) * 100) / 100;
  const left = finite(run?.maxBudgetUsd) ? Math.max(0, cap - spent) : null;
  return `${label ? `${label}: ` : ''}${aiUsd != null ? `about ${money(aiUsd)} AI for ${plural(count, 'report')}` : `${plural(count, 'report')}`}${left != null ? ` (${money(left)} left of its ${money(cap)} AI budget)` : ''}.`;
}
// Every run being written at once (at most three named), then the Codex note.
export async function reportCostLines({ api, runs = [], codex = false } = {}) {
  const lines = [];
  for (const row of runs.slice(0, 3)) lines.push(await reportCostLine({ api, run: row.run, program: row.program, count: row.count, label: runs.length > 1 ? row.run?.title || 'One run' : '' }));
  if (codex) lines.push(CODEX_UNCAPPED);
  return lines;
}

// The jobs an estimate runs on a connection that reports no cost (Model routing: Codex), as one sentence; an older
// estimate that only says route 'codex' gets the general Codex line.
export function uncappedLine(estimate = {}) {
  const tasks = [...new Set(list(estimate?.uncappedTasks).filter(Boolean))].map((label) => label.charAt(0).toLowerCase() + label.slice(1));
  if (tasks.length) return `On Codex the studio can’t cap spend for ${tasks.length > 1 ? `${tasks.slice(0, -1).join(', ')} and ${tasks.at(-1)}` : tasks[0]}, so the AI cap is a guide there.`;
  return estimate?.route === 'codex' ? CODEX_UNCAPPED : '';
}

// Room for what's left of a run: finished work is never paid for twice (studio-actions' rule, for every panel).
export const retryCap = sharedRetryCap;

// Asked before the cost question when a prompt changed since the run started, so the last question (the money one)
// always has a Cancel that stops the retry. Cancel here keeps the run's own prompts.
export function newestPromptsQuestion(newer = [], noun = 'run') {
  return { title: 'Use the newest prompts?', lines: [newestPromptsLine(newer)], items: newer.map((change) => `${change.name || change.promptName || change.promptId} · version ${change.version}`).slice(0, 12), confirmLabel: 'Use the newest prompts', cancelLabel: `Keep the ${noun}’s prompts` };
}
