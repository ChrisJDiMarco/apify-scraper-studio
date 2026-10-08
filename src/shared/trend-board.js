// Trend board: one card per discovered research theme, placed in the column its real run state implies.
// Pure and renderer-side; Monday.com sync receives the same cards (see src/main/monday-sync.js).

export const TREND_STAGES = [
  { id: 'potential', label: 'Potential trends', hint: 'Scouted by research. Needs your OK.' },
  { id: 'approved', label: 'Approved', hint: 'OK’d. Generate reports when you’re ready.' },
  { id: 'production', label: 'In production', hint: 'Reports and assets being written.' },
  { id: 'ready', label: 'Ready to use', hint: 'Reports done. Create assets any time.' },
];
export const PASSED_STAGE = { id: 'passed', label: 'Passed', hint: 'Not taken forward.' };

const list = (value) => (Array.isArray(value) ? value : []);
const ACTIVE = new Set(['queued', 'running']);
const TROUBLE = new Set(['failed', 'partial', 'cancelled']);
const REPORT_DELIVERABLES = new Set(['evidence-report', 'editorial-toolkit']);

function baseCard(run, theme, programName) {
  return {
    key: `${run.id}:${theme.id}`,
    runId: run.id,
    themeId: theme.id,
    name: theme.name || 'Untitled trend',
    description: theme.description || '',
    evidenceCount: Number(theme.evidenceCount ?? list(theme.evidenceIds).length) || 0,
    platforms: list(theme.platforms),
    novelty: theme.novelty || '',
    category: theme.scoring?.taxonomy?.category && theme.scoring.taxonomy.category !== 'UNMAPPED' ? theme.scoring.taxonomy.category : theme.taxonomyCategory || '',
    priorityTier: theme.scoring?.priorityTier || '',
    priorityScore: Number.isFinite(theme.scoring?.priorityScore) ? theme.scoring.priorityScore : null,
    velocity: theme.scoring?.velocity || '',
    detectionCount: theme.scoring?.count || 1,
    gapSignal: theme.scoring?.gapSignal || '',
    matchedExisting: Boolean(theme.match?.matched),
    keywords: list(theme.matchingKeywords).slice(0, 6),
    programId: run.programId || '',
    programName: programName || run.title || 'Research run',
    discoveredAt: run.createdAt || '',
  };
}

export function buildTrendBoard({ researchRuns = [], contentRuns = [], assets = [], programs = [] } = {}) {
  const programNames = new Map(list(programs).map((program) => [program.id, program.name]));
  const contentById = new Map(list(contentRuns).map((run) => [run.id, run]));
  const cards = [];
  const scouting = [];
  for (const run of list(researchRuns)) {
    const discovered = list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes);
    const programName = programNames.get(run.programId);
    if (!discovered.length) {
      // Still collecting or discovering: show the run so new trends never appear from nowhere.
      if (ACTIVE.has(run.status) || run.status === 'failed') scouting.push({ runId: run.id, programId: run.programId || '', title: programName || run.title || 'Research run', status: run.status, stage: run.stage || '', progress: run.discoveryProgress || null, message: run.message || '', error: typeof run.error === 'string' ? run.error : run.error?.message || '', createdAt: run.createdAt || '' });
      continue;
    }
    if (run.status === 'cancelled' && !run.reportRunIds?.length) continue;
    const decisions = run.decisions || {};
    if (run.status === 'awaiting-review') {
      for (const theme of discovered) {
        const decision = decisions[theme.id];
        cards.push({ ...baseCard(run, theme, programName), stage: decision === 'approved' ? 'approved' : decision === 'passed' ? 'passed' : 'potential', decision: decision || 'pending', canDecide: true });
      }
      continue;
    }
    const approved = new Map(list(run.themes).map((theme) => [theme.id, theme]));
    for (const original of discovered) {
      const theme = approved.get(original.id);
      if (!theme) { cards.push({ ...baseCard(run, original, programName), stage: 'passed', decision: 'passed', canDecide: false }); continue; }
      const card = { ...baseCard(run, theme, programName), decision: 'approved', canDecide: false };
      const entry = list(run.reportRunIds).find((row) => row.themeId === theme.id);
      const report = entry && contentById.get(entry.runId);
      if (report?.status === 'succeeded') {
        const reportAssets = list(assets).filter((asset) => asset.runId === report.id && REPORT_DELIVERABLES.has(asset.deliverableId));
        const reportAssetIds = new Set(reportAssets.map((asset) => asset.id));
        const followUps = list(contentRuns).filter((row) => row.sourceAssetId && reportAssetIds.has(row.sourceAssetId));
        const followUpIds = new Set(followUps.map((row) => row.id));
        const creating = followUps.some((row) => ACTIVE.has(row.status));
        cards.push({ ...card, stage: creating ? 'production' : 'ready', activity: creating ? 'Creating assets' : '', reportRunId: report.id, reportAssets: reportAssets.map(({ id, title, deliverableId }) => ({ id, title, deliverableId })), assetCount: list(assets).filter((asset) => followUpIds.has(asset.runId)).length, contentRunCount: followUps.length });
        continue;
      }
      const stuck = TROUBLE.has(report?.status) || (TROUBLE.has(run.status) && !ACTIVE.has(report?.status));
      const activity = report ? 'Writing reports' : run.stage === 'classification' ? `Sorting evidence${run.assignmentProgress ? ` · ${run.assignmentProgress.completed} of ${run.assignmentProgress.total}` : ''}` : 'Queued for reports';
      cards.push({ ...card, stage: 'production', activity: stuck ? 'Needs attention' : activity, needsAttention: stuck, reportRunId: report?.id || '' });
    }
  }
  const tierRank = (card) => ({ 'FAST-TRACK': 0, STRONG: 1, MONITOR: 2, LOW: 3 }[card.priorityTier] ?? 4);
  const order = (a, b) => String(b.discoveredAt).localeCompare(String(a.discoveredAt)) || tierRank(a) - tierRank(b) || b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name);
  cards.sort(order);
  const columns = Object.fromEntries([...TREND_STAGES, PASSED_STAGE].map((stage) => [stage.id, cards.filter((card) => card.stage === stage.id)]));
  return { columns, cards, scouting: scouting.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}

// One run generates reports for every approved trend at once (evidence is classified per run).
export function generationPlan(cards, runId) {
  const own = list(cards).filter((card) => card.runId === runId && card.canDecide);
  return { approved: own.filter((card) => card.decision === 'approved'), undecided: own.filter((card) => card.decision === 'pending') };
}
