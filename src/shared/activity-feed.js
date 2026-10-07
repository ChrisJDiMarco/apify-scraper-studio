// Activity: one timeline for everything the workspace does — collections, research, content, AI analyses, background jobs.

const list = (value) => (Array.isArray(value) ? value : []);
const ACTIVE = new Set(['queued', 'running', 'awaiting-review']);
const TROUBLE = new Set(['failed', 'partial', 'cancelled']);
export const ACTIVITY_KINDS = [
  { id: 'collection', label: 'Collections' },
  { id: 'research', label: 'Research' },
  { id: 'content', label: 'Content' },
  { id: 'analysis', label: 'AI analysis' },
  { id: 'job', label: 'Other jobs' },
];

export function activityState(status) {
  if (status === 'awaiting-review') return 'review';
  if (ACTIVE.has(status)) return 'active';
  if (TROUBLE.has(status)) return 'attention';
  if (status === 'succeeded' || status === 'completed') return 'done';
  return 'idle';
}

function durationMs(start, end) {
  const a = Date.parse(start || ''); const b = Date.parse(end || '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

export function formatDuration(ms) {
  if (ms == null) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}m`;
}

// Exit codes mean nothing to a reviewer; say what happened and where to fix it.
export const humanizeRunMessage = (value) => {
  const text = String(value || '').trim();
  const exit = /^(Claude|Codex|AI) exited with (?:code )?(\d+)\.?$/i.exec(text);
  return exit ? `${/codex/i.test(exit[1]) ? 'Codex' : 'Claude'} stopped before finishing (exit code ${exit[2]}). Check the Claude connection in Settings, then retry.` : text;
};
const errorText = (error) => humanizeRunMessage(typeof error === 'string' ? error : error?.message || '');

export function buildActivity(state = {}) {
  const recipes = new Map(list(state.recipes).map((recipe) => [recipe.id, recipe]));
  const datasets = new Map(list(state.datasets).map((dataset) => [dataset.id, dataset]));
  const studio = state.contentStudio || {};
  const programs = new Map(list(studio.programs).map((program) => [program.id, program.name]));
  const entries = [];
  const seen = new Set();
  const add = (entry) => { if (!entry.id || seen.has(entry.id)) return; seen.add(entry.id); entries.push({ ...entry, state: activityState(entry.status), durationMs: entry.durationMs ?? durationMs(entry.startedAt, entry.finishedAt) }); };

  for (const run of list(state.runs)) {
    const recipe = recipes.get(run.recipeId);
    add({ id: run.id, kind: 'collection', title: recipe?.name || run.actorId || run.taskId || 'Collection run', subtitle: [run.platform, recipe?.actorId || run.actorId].filter(Boolean).join(' · '), status: run.status || 'idle', startedAt: run.startedAt, finishedAt: run.finishedAt, itemCount: run.itemCount, error: errorText(run.error), recipeId: recipe?.id || '', datasetId: datasets.has(run.datasetId) ? run.datasetId : '', raw: run });
  }
  for (const run of list(studio.researchRuns)) {
    const finished = !ACTIVE.has(run.status);
    add({ id: run.id, kind: 'research', title: programs.get(run.programId) || run.title || 'Research run', subtitle: run.status === 'awaiting-review' ? `${list(run.discoveredThemes || run.themes).length} trends waiting for your OK` : humanizeRunMessage(run.message), status: run.status || 'idle', startedAt: run.createdAt, finishedAt: finished ? run.updatedAt : '', costUsd: run.costUsd, error: errorText(run.error), studioRunId: run.id, raw: run });
  }
  for (const run of list(studio.contentRuns)) {
    const finished = !ACTIVE.has(run.status);
    const jobs = list(run.jobs);
    add({ id: run.id, kind: 'content', title: run.title || 'Content run', subtitle: jobs.length ? `${jobs.filter((job) => job.status === 'succeeded').length} of ${jobs.length} deliverables` : '', status: run.status || 'idle', startedAt: run.createdAt, finishedAt: finished ? run.updatedAt : '', costUsd: run.costUsd, error: errorText(run.error), studioRunId: run.id, raw: run });
  }
  for (const analysis of list(state.analyses)) {
    const dataset = datasets.get(analysis.datasetId);
    add({ id: analysis.id, kind: 'analysis', title: analysis.reportPresetName || `${analysis.kind === 'thread' ? 'Thread summary' : analysis.kind === 'tag' ? 'AI tagging' : 'AI report'}`, subtitle: dataset?.name || analysis.datasetSnapshot?.name || '', status: analysis.status || 'idle', startedAt: analysis.startedAt || analysis.createdAt, finishedAt: analysis.finishedAt, error: errorText(analysis.error), datasetId: dataset ? dataset.id : '', analysisId: analysis.id, raw: analysis });
  }
  for (const job of list(state.jobs)) {
    add({ id: job.id, kind: 'job', title: job.title || job.kind || 'Background job', subtitle: job.kind ? `${job.kind[0].toUpperCase()}${job.kind.slice(1)} job` : '', status: job.status || 'idle', startedAt: job.startedAt, finishedAt: job.finishedAt, error: errorText(job.error), jobId: job.id, cancellable: Boolean(job.cancellable), raw: job });
  }
  return entries.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

export function filterActivity(entries, { kind = 'all', state = 'all', query = '', sinceDays = 0, now = Date.now() } = {}) {
  const needle = query.trim().toLowerCase();
  const since = sinceDays ? now - sinceDays * 86400000 : -Infinity;
  return list(entries).filter((entry) => (kind === 'all' || entry.kind === kind)
    && (state === 'all' || entry.state === state)
    && (Date.parse(entry.startedAt || '') || 0) >= since
    && (!needle || `${entry.title} ${entry.subtitle} ${entry.status} ${entry.error}`.toLowerCase().includes(needle)));
}

export function activitySummary(entries, now = Date.now()) {
  const week = now - 7 * 86400000;
  const recent = list(entries).filter((entry) => (Date.parse(entry.startedAt || '') || 0) >= week);
  return {
    active: list(entries).filter((entry) => entry.state === 'active').length,
    review: list(entries).filter((entry) => entry.state === 'review').length,
    attention: recent.filter((entry) => entry.state === 'attention').length,
    doneThisWeek: recent.filter((entry) => entry.state === 'done').length,
    spendThisWeek: recent.reduce((sum, entry) => sum + (Number(entry.costUsd) || 0), 0),
    rowsThisWeek: recent.reduce((sum, entry) => sum + (entry.kind === 'collection' ? Number(entry.itemCount) || 0 : 0), 0),
  };
}

// "Today", "Yesterday", or a date, for grouping the timeline.
export function dayLabel(iso, now = new Date()) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return 'Undated';
  const day = new Date(time); const today = new Date(now);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: diff < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
