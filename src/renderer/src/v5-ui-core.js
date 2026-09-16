function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function slug(value, fallback = 'item') {
  const text = String(value || fallback).toLowerCase().trim()
    .replace(/[^a-z0-9._~@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function selectedDataset(state = {}) {
  const datasets = list(state.datasets);
  return datasets.find((dataset) => dataset.id === state.selectedDatasetId) || datasets[0] || null;
}

function selectedProfile(state = {}, datasetId = '') {
  return list(state.intelligence?.datasetProfiles).find((profile) => profile.datasetId === datasetId) || null;
}

export function buildActionGraph(command = '', state = {}) {
  const text = lower(command);
  const dataset = selectedDataset(state);
  const profile = dataset ? selectedProfile(state, dataset.id) : null;
  const recipe = list(state.recipes)[0] || null;
  const steps = [];
  const missing = [];
  const wantsScrape = /scrape|crawl|collect|run|watch|listen/.test(text);
  const wantsLead = /lead|prospect|csv|sheet/.test(text);
  const wantsCompetitor = /competitor|competitive|pricing|positioning/.test(text);
  const wantsAsset = /asset|post|campaign|launch|copy|linkedin|twitter|x /.test(text);
  const presetId = wantsCompetitor ? 'competitor-watch' : wantsAsset ? 'launch-angles' : wantsLead ? 'lead-sheet' : 'reddit-pulse';
  const reportPresetId = wantsCompetitor ? 'competitive-report' : wantsLead ? 'lead-list' : profile?.reportPresetId || 'market-scan';
  if (wantsScrape || (!dataset && recipe)) {
    if (!recipe) missing.push('Save a recipe before running a scrape step.');
    else steps.push({ id: 'run-recipe', action: 'run-recipe', label: `Run ${recipe.name || recipe.id}`, args: { recipeId: recipe.id }, editable: true });
  }
  if (!dataset) {
    if (!steps.length) missing.push('Select or create a dataset before analysis steps.');
  } else {
    steps.push({ id: 'analyze-dataset', action: 'analyze-dataset', label: reportPresetId === 'lead-list' ? 'Build lead report' : 'Build analyst report', args: { datasetId: dataset.id, kind: 'report', reportPresetId }, editable: true });
    if (wantsLead) steps.push({ id: 'export-dataset', action: 'export-dataset', label: 'Export CSV', args: { datasetId: dataset.id, format: 'csv' }, editable: true });
    steps.push({ id: 'create-card', action: 'create-card', label: 'Create production card', args: { datasetId: dataset.id, title: `${dataset.name || 'Dataset'} follow-up` }, editable: true });
    if (wantsAsset) steps.push({ id: 'generate-assets', action: 'generate-assets', label: 'Generate asset pack', args: { datasetId: dataset.id, presetId: 'launch-pack' }, editable: true });
  }
  return {
    id: `graph-${slug(command || presetId)}`,
    command: cleanText(command),
    presetId,
    targetDatasetId: dataset?.id || '',
    targetRecipeId: recipe?.id || '',
    steps,
    missing,
    canRun: steps.length > 0 && missing.length === 0,
  };
}

export function evaluateArtifact(artifact = {}, evidence = []) {
  const evidenceIds = [...new Set(list(artifact.evidenceIds).filter(Boolean))];
  const evidenceById = new Map(list(evidence).map((item) => [item.id, item]));
  const matched = evidenceIds.filter((id) => evidenceById.has(id));
  const markdown = cleanText(artifact.markdown || artifact.markdownReport || artifact.summary);
  const sentences = markdown.split(/[.!?]\s+/).map(cleanText).filter((sentence) => sentence.length > 24);
  const unsupported = sentences.filter((sentence) => {
    const terms = lower(sentence).split(/\W+/).filter((term) => term.length > 4).slice(0, 8);
    if (!terms.length) return false;
    return !matched.some((id) => terms.some((term) => lower(evidenceById.get(id)?.text || '').includes(term)));
  });
  const coverage = evidenceIds.length ? matched.length / evidenceIds.length : 0;
  const issues = [];
  if (!evidenceIds.length) issues.push('No evidence IDs attached.');
  if (coverage < 1) issues.push('Some evidence IDs do not exist in the evidence graph.');
  if (unsupported.length) issues.push(`Unsupported claim count: ${unsupported.length}.`);
  const score = Math.max(0, Math.min(100, 100 - issues.length * 22 - unsupported.length * 8 + Math.round(coverage * 20)));
  return {
    passed: score >= 80 && issues.length === 0,
    score,
    evidenceCoverage: Number(coverage.toFixed(2)),
    unsupportedClaims: unsupported,
    issues,
  };
}
