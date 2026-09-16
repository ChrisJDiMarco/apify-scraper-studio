export function runRecipeLabel(run = {}, recipe = null) {
  return recipe?.name || run.actorId || run.taskId || run.recipeId || 'Untitled run';
}

export function runDurationLabel(run = {}) {
  if (!run.startedAt) return '';
  if (!run.finishedAt && run.status === 'running') return 'Running';
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.finishedAt || run.startedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function runSearchText(run = {}, recipe = null) {
  return [
    run.status,
    run.platform,
    runRecipeLabel(run, recipe),
    run.actorId,
    run.taskId,
    run.apifyRunId,
    run.defaultDatasetId,
    run.datasetId,
    run.error,
  ].filter(Boolean).join(' ');
}
