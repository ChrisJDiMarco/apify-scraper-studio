function list(value) {
  return Array.isArray(value) ? value : [];
}

export function summarizeStudio(state = {}) {
  const recipes = list(state.recipes);
  const runs = list(state.runs);
  const datasets = list(state.datasets);
  const analyses = list(state.analyses);
  const jobs = list(state.jobs);
  const cards = list(state.cards);
  const assets = list(state.assets);
  const totalItems = datasets.reduce((sum, dataset) => sum + (Number(dataset.itemCount) || 0), 0);
  const assetsDone = assets.filter((asset) => ['approved', 'done', 'posted'].includes(asset.status)).length;

  return {
    recipes: recipes.length,
    runs: runs.length,
    datasets: datasets.length,
    analyses: analyses.length,
    cards: cards.length,
    assets: assets.length,
    assetsDone,
    reports: analyses.filter((analysis) => analysis.kind === 'report').length,
    tagged: analyses.filter((analysis) => analysis.kind === 'tag' && analysis.status === 'succeeded').length,
    threads: analyses.filter((analysis) => analysis.kind === 'thread' && analysis.status === 'succeeded').length,
    totalItems,
    activeJobs: jobs.length,
    apifyConnected: Boolean(state.keys?.APIFY_API_TOKEN),
    latestDataset: datasets[0] || null,
    latestRun: runs[0] || null,
  };
}

export function countByStatus(records = []) {
  return list(records).reduce((counts, record) => {
    const status = record.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

export function derivePlatformBreakdown(datasets = []) {
  return Object.values(list(datasets).reduce((acc, dataset) => {
    const platform = dataset.platform || 'unknown';
    if (!acc[platform]) acc[platform] = { platform, datasets: 0, items: 0 };
    acc[platform].datasets += 1;
    acc[platform].items += Number(dataset.itemCount) || 0;
    return acc;
  }, {})).sort((a, b) => b.items - a.items || a.platform.localeCompare(b.platform));
}

export function buildPipeline(state = {}) {
  const metrics = summarizeStudio(state);
  const runStatus = countByStatus(state.runs);
  const analysisStatus = countByStatus(state.analyses);

  return [
    {
      id: 'recipes',
      title: 'Listening Recipes',
      count: metrics.recipes,
      detail: metrics.apifyConnected ? 'Apify token connected' : 'Needs Apify token',
      tone: metrics.apifyConnected ? 'ready' : 'warning',
    },
    {
      id: 'runs',
      title: 'Scrape Runs',
      count: metrics.runs,
      detail: `${runStatus.succeeded || 0} complete, ${runStatus.failed || 0} failed`,
      tone: (runStatus.failed || 0) > 0 ? 'warning' : 'ready',
    },
    {
      id: 'datasets',
      title: 'Normalized Signals',
      count: metrics.totalItems,
      detail: metrics.latestDataset ? metrics.latestDataset.name : 'No dataset captured yet',
      tone: metrics.datasets ? 'ready' : 'neutral',
    },
    {
      id: 'codex',
      title: 'Codex Intelligence',
      count: metrics.analyses,
      detail: `${analysisStatus.succeeded || 0} complete, ${analysisStatus.failed || 0} failed`,
      tone: (analysisStatus.failed || 0) > 0 ? 'warning' : 'ready',
    },
    {
      id: 'assets',
      title: 'Asset Factory',
      count: metrics.assets,
      detail: `${metrics.assetsDone} complete, ${metrics.cards} cards`,
      tone: metrics.assets ? 'ready' : 'neutral',
    },
  ];
}

export function groupThreads(items = []) {
  const groups = new Map();
  for (const item of list(items)) {
    const key = item.threadId || item.parentId || item.id || 'unthreaded';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return Array.from(groups.entries()).map(([id, threadItems]) => ({
    id,
    root: threadItems.find((item) => !item.parentId) || threadItems[0],
    replies: threadItems.filter((item) => item.parentId),
    items: threadItems,
  })).sort((a, b) => b.items.length - a.items.length || String(a.id).localeCompare(String(b.id)));
}
