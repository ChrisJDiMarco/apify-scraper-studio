// One trend, one stage, one next step. Pure and renderer-side (ESM): the trend card, the trend page, the Trends chips and
// Home all read a board card (src/shared/trend-board.js) through stageOf, so a trend is described in the same words and
// offers the same button wherever it appears. Every next step is gated by what the role can do (`can`, viewer.js): a
// step this person can't take is left out rather than shown disabled.
//
// stageOf(card, { can }) → { id, label, tone, detail, next }
//   id     one of TREND_STAGE_IDS
//   tone   'action' (waiting on a person) · 'working' (the studio is busy) · 'done' · 'muted' · 'attention'
//   next   null, or { id, label, … }:
//     decide         approve this trend (the caller also offers Skip)
//     write-reports  { runId } writes reports for every approved trend in that research run, behind its cost check
//     retry          { runId } try a stopped run again
//     make-assets    { assetId } the Make channel assets dialog on that report
//     open-assets    open the trend's channel assets
//     restore        bring a skipped trend back (only while its run is still under review)
//     unarchive      bring an archived trend back to Ready or Skipped
const list = (value) => (Array.isArray(value) ? value : []);

export const TREND_STAGE_IDS = Object.freeze(['needs-ok', 'approved', 'writing', 'report-ready', 'making-assets', 'assets-ready', 'attention', 'skipped', 'archived']);
export const STAGE_LABELS = Object.freeze({
  'needs-ok': 'Needs your OK',
  approved: 'Approved',
  writing: 'Writing reports',
  'report-ready': 'Report ready',
  'making-assets': 'Making assets',
  'assets-ready': 'Assets ready',
  attention: 'Needs attention',
  skipped: 'Skipped',
  archived: 'Archived',
});
const TONES = Object.freeze({ 'needs-ok': 'action', approved: 'action', writing: 'working', 'report-ready': 'action', 'making-assets': 'working', 'assets-ready': 'done', attention: 'attention', skipped: 'muted', archived: 'muted' });

// The trends report first, then the toolkit, as every reader opens them.
export const reportOf = (card) => list(card?.reportAssets).find((asset) => asset.deliverableId === 'evidence-report') || list(card?.reportAssets)[0] || null;

// A board card's stage id. The board has one "Being written" column for reports and for assets, and one "Ready" column
// for a report with and without assets; the card's own fields tell them apart.
export function stageIdOf(card = {}) {
  if (card.stage === 'potential') return 'needs-ok';
  if (card.stage === 'approved') return 'approved';
  if (card.stage === 'archived') return 'archived';
  if (card.stage === 'passed') return 'skipped';
  if (card.stage === 'production') return card.needsAttention ? 'attention' : card.activity === 'Creating assets' ? 'making-assets' : 'writing';
  if (card.stage === 'ready') return Number(card.assetCount) > 0 ? 'assets-ready' : 'report-ready';
  return 'writing';
}

export function stageOf(card = {}, { can = () => false } = {}) {
  const id = stageIdOf(card);
  const base = { id, label: STAGE_LABELS[id], tone: TONES[id], detail: '', next: null };
  if (id === 'needs-ok') return { ...base, next: card.canDecide && can('decideResearchTheme') ? { id: 'decide', label: 'Approve' } : null };
  if (id === 'approved') return { ...base, detail: 'Reports are written for every approved trend in the run at once.', next: card.canDecide && can('approveResearchThemes') && can('continueResearchRun') ? { id: 'write-reports', runId: card.runId, label: 'Write reports' } : null };
  if (id === 'writing') return { ...base, detail: card.activity || '' };
  if (id === 'attention') return { ...base, detail: 'This stopped before it finished. Finished work is kept.', next: can('retryStudioRun') ? { id: 'retry', runId: card.reportRunId || card.runId, label: 'Try again' } : null };
  if (id === 'making-assets') return { ...base, detail: 'Channel assets are being made from the report.', next: { id: 'open-assets', label: 'See progress' } };
  if (id === 'report-ready') { const report = reportOf(card); return { ...base, next: report && can('planAssetKit') && can('createAssetKit') ? { id: 'make-assets', assetId: report.id, label: 'Make channel assets' } : null }; }
  if (id === 'archived') return { ...base, detail: 'Filed away. Its reports and assets are still in Assets.', next: can('setTrendArchived') ? { id: 'unarchive', label: 'Bring back' } : null };
  if (id === 'assets-ready') return { ...base, detail: `${card.assetCount} ${Number(card.assetCount) === 1 ? 'asset' : 'assets'} made.`, next: { id: 'open-assets', label: 'Open channel assets' } };
  return { ...base, next: card.canDecide && can('decideResearchTheme') ? { id: 'restore', label: 'Bring back' } : null };
}

// The Trends chips: every stage that has a trend, in pipeline order, with its count. Skipped is always last.
export function stageCounts(cards) {
  const counts = new Map();
  for (const card of list(cards)) { const id = stageIdOf(card); counts.set(id, (counts.get(id) || 0) + 1); }
  return TREND_STAGE_IDS.filter((id) => counts.has(id)).map((id) => ({ id, label: STAGE_LABELS[id], count: counts.get(id) }));
}

// The card a trend page opens for a theme that several research runs found: one waiting for a decision first, then the
// newest with reports, then the newest. `runId` picks one outright.
export function cardForTheme(cards, themeId, runId = '') {
  const own = list(cards).filter((card) => card.themeId === themeId);
  if (!own.length) return null;
  const newest = (a, b) => String(b.discoveredAt || '').localeCompare(String(a.discoveredAt || ''));
  return (runId && own.find((card) => card.runId === runId))
    || own.filter((card) => card.stage === 'potential').sort(newest)[0]
    || own.filter((card) => list(card.reportAssets).length).sort(newest)[0]
    || [...own].sort(newest)[0];
}
