'use strict';
// What a channel owner sees: trends whose brief is ready, and only their own channel's kit runs and files. Pure CommonJS
// for the main process. src/shared/trend-board.js is ESM and renderer-only, so its "ready" rule is reproduced here once
// (readyTrends, which team-analytics.js reuses); test/channel-view.test.js keeps the two in step.
const kit = require('../shared/asset-kit');
const content = require('../shared/content-studio');

const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const newestFirst = (field) => (a, b) => (time(b[field]) || 0) - (time(a[field]) || 0);
const ACTIVE = new Set(['queued', 'running']);
const REPORT_DELIVERABLES = new Set(['evidence-report', 'editorial-toolkit']);
// Research priority tiers in the words a channel owner reads.
const PRIORITY = Object.freeze({ 'FAST-TRACK': 'top', STRONG: 'strong', MONITOR: 'watch' });
const TIER_RANK = Object.freeze({ 'FAST-TRACK': 0, STRONG: 1, MONITOR: 2, LOW: 3 });
// A trend whose brief was ready more than 14 days before someone joined waits in a collapsed "Earlier" group, so it
// neither swamps their New count nor counts against them.
const EARLIER_MS = 14 * 86400000;
// A run stopped by a missing key, sign-in, setting or the account's credit is something only an admin can fix.
const NEEDS_ADMIN = /(api[\s_-]?keys?|\bkeys?\b|\bsettings\b|\btokens?\b|\blog(?:ged)?[\s-]?in\b|\bsign(?:ed)?[\s-]?in\b|\bcredentials?\b|\bunauthori[sz]ed\b|\bauthenticat|\bcredits?\b|\bbilling\b)/i;
const NEEDS_ADMIN_MESSAGE = 'Ask an admin: the AI connection needs attention.';
const UNFINISHED = new Set(['failed', 'partial', 'cancelled']);
// Where an asset is in the team's pipeline (content-workspace setAssetStatus); anything else reads as a draft.
const ASSET_STATUSES = new Set(['draft', 'in-review', 'approved', 'scheduled', 'published']);

const descriptorOf = (id) => content.CONTENT_DELIVERABLES.find((entry) => entry.id === id);
// A deliverable's channel: kitFolderFor(deliverableId, editionId).id, from one lookup table per edition because every
// projection asks it for each job and file.
const FOLDER_INDEX = new Map();
function channelOf(deliverableId, editionId = 'general') {
  const edition = String(editionId || 'general');
  let index = FOLDER_INDEX.get(edition);
  if (!index) { index = new Map(kit.kitFolders(edition).flatMap((folder) => folder.deliverableIds.map((id) => [id, folder.id]))); FOLDER_INDEX.set(edition, index); }
  return index.get(deliverableId) || 'other';
}
const folderOf = channelOf;
const editedOf = (asset) => (asset?.edited?.at ? { at: asset.edited.at, byName: asset.edited.by?.name || '' } : null);

// A kit run's channels come from its job ids (they are deliverable ids), never job.folder, which holds a display name.
function kitChannelIds(run, editionId = 'general') {
  if (!run?.kit) return [];
  return [...new Set(list(run.jobs).map((job) => folderOf(job.id, editionId)))];
}
const channelJobs = (run, channelId, editionId) => list(run?.jobs).filter((job) => folderOf(job.id, editionId) === channelId);

// The run as this channel sees it: a shared set can still be writing other channels' files after this one's are done (or
// failed), so a channel whose own files are all settled is finished even while the set runs on. A retry puts its unfinished
// files back to queued, so a failed file waiting for another try still counts as in progress.
function channelStatus(run, jobs) {
  if (jobs.length && jobs.every((job) => job.status === 'succeeded')) return 'succeeded';
  if (ACTIVE.has(run.status) && (!jobs.length || jobs.some((job) => ACTIVE.has(job.status || 'queued')))) return run.status;
  if (run.status === 'cancelled') return 'cancelled';
  return jobs.some((job) => job.status === 'succeeded' || list(job.assetIds).length) ? 'partial' : 'failed';
}
// Only an admin can fix this channel's failure (a key, a sign-in, a setting, credit). A shared set's run message can be
// about another channel's file, so only this channel's own errors count there.
const needsAdmin = (run, jobs, status, shared) => UNFINISHED.has(status) && status !== 'cancelled' && [shared ? '' : run.message, ...jobs.map((job) => job.error)].some((text) => typeof text === 'string' && NEEDS_ADMIN.test(text));
// Messages come from a fixed plain set, so another channel's file names, costs or provider errors never show through.
function kitMessage(run, jobs, status, done, total, adminNeeded) {
  if (status === 'queued') return 'Starting…';
  if (status === 'running') return `Writing ${Math.min(done + 1, total)} of ${total}…`;
  if (status === 'succeeded') {
    const files = jobs.reduce((sum, job) => sum + (list(job.assetIds).length || (job.assetId ? 1 : 0)), 0) || total;
    return files === 1 ? 'Your file is ready.' : `All ${files} files are ready.`;
  }
  if (adminNeeded) return NEEDS_ADMIN_MESSAGE;
  if (status === 'cancelled') return 'Stopped.';
  return 'Some files didn’t finish. Try again.';
}

// Never includes cost, receipts, budgets, the model, warnings or other channels' jobs.
function publicKitRun(run, channelId, editionId = 'general') {
  const jobs = channelJobs(run, channelId, editionId);
  const done = jobs.filter((job) => job.status === 'succeeded').length; const total = jobs.length;
  const status = channelStatus(run, jobs); const shared = kitChannelIds(run, editionId).length > 1; const adminNeeded = needsAdmin(run, jobs, status, shared);
  return {
    id: run.id, title: run.kit?.sourceTitle || run.title || 'Untitled trend', status, message: kitMessage(run, jobs, status, done, total, adminNeeded),
    ...(adminNeeded ? { needsAdmin: true } : {}),
    progress: { done, total }, createdAt: run.createdAt || '', finishedAt: ACTIVE.has(status) ? null : run.updatedAt || null,
    kit: { sourceTitle: run.kit?.sourceTitle || run.title || '', themeId: run.kit?.themeId || null, folderName: run.kit?.folderName || '', reportAssetId: run.kit?.reportAssetId || null },
    shared,
    jobs: jobs.map((job) => ({ id: job.id, label: job.label || descriptorOf(job.id)?.label || job.id, kind: job.kind || descriptorOf(job.id)?.kind || 'text', status: job.status || 'queued', assetId: job.assetId || null, assetIds: list(job.assetIds).filter((id) => typeof id === 'string') })),
  };
}

// Trends whose brief is ready, one per theme. Mirrors buildTrendBoard: a research run that is still awaiting review, or was
// cancelled before any report, shows nothing ready; an approved theme is ready when the report run its research run lists
// first for it succeeded. Across runs a theme is ready if any of those succeeded, and the newest one supplies readyAt
// (its newest report file) and the report assets.
function readyTrends(contentStudio = {}) {
  const contentRuns = new Map(list(contentStudio.contentRuns).map((run) => [run.id, run]));
  // Report files grouped by run once, so finding a theme's brief is a lookup, not a scan of every asset.
  const reportFiles = new Map();
  for (const asset of list(contentStudio.assets)) {
    if (!asset || !REPORT_DELIVERABLES.has(asset.deliverableId)) continue;
    let rows = reportFiles.get(asset.runId); if (!rows) { rows = []; reportFiles.set(asset.runId, rows); }
    rows.push(asset);
  }
  const repository = new Map(list(contentStudio.themes).map((theme) => [theme.id, theme]));
  const ready = new Map();
  for (const run of list(contentStudio.researchRuns)) {
    const discovered = list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes);
    if (!discovered.length || run.status === 'awaiting-review' || (run.status === 'cancelled' && !list(run.reportRunIds).length)) continue;
    const approved = new Map(list(run.themes).map((theme) => [theme.id, theme]));
    for (const original of discovered) {
      const theme = approved.get(original?.id); if (!theme) continue;
      const entry = list(run.reportRunIds).find((row) => row.themeId === theme.id);
      const report = entry && contentRuns.get(entry.runId);
      if (report?.status !== 'succeeded') continue;
      const files = reportFiles.get(report.id) || [];
      const newestFile = [...files].sort(newestFirst('createdAt'))[0];
      const readyAt = newestFile?.createdAt || report.updatedAt || report.createdAt || run.createdAt || '';
      const previous = ready.get(theme.id);
      if (previous && !(time(readyAt) > time(previous.readyAt))) continue;
      const primary = files.find((asset) => asset.deliverableId === 'editorial-toolkit') || files.find((asset) => asset.deliverableId === 'evidence-report') || null;
      const tracked = repository.get(theme.id) || {};
      const tier = theme.scoring?.priorityTier || tracked.scoring?.priorityTier || '';
      // Who said yes, with their note and the channels they routed it to ([] = every channel). Automatic approval
      // (autoApproveThemes) is said as such, not as a person.
      const by = run.decisionsBy?.[theme.id];
      const decidedBy = by ? { name: String(by.name || ''), at: by.at || null, auto: by.id === 'system', note: typeof by.note === 'string' ? by.note : '', channels: list(by.channels).filter((id) => typeof id === 'string') } : null;
      ready.set(theme.id, {
        themeId: theme.id, name: theme.name || tracked.name || 'Untitled trend', description: theme.description || tracked.description || '',
        category: theme.scoring?.taxonomy?.category && theme.scoring.taxonomy.category !== 'UNMAPPED' ? theme.scoring.taxonomy.category : theme.taxonomyCategory || '',
        priorityTier: tier, priority: PRIORITY[tier] || null, evidenceCount: Number(theme.evidenceCount ?? list(theme.evidenceIds).length) || 0,
        readyAt, researchRunId: run.id, reportRunId: report.id,
        reportAssets: files.map(({ id, title, deliverableId }) => ({ id, title: title || '', deliverableId })),
        primaryReportId: primary?.id || null, briefEditedAt: primary?.edited?.at || null, decidedBy,
      });
    }
  }
  const rank = (trend) => TIER_RANK[trend.priorityTier] ?? 4;
  return [...ready.values()].sort((a, b) => (time(b.readyAt) || 0) - (time(a.readyAt) || 0) || rank(a) - rank(b) || b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name));
}

// The set a trend's card shows: the newest, unless that is a set made with other channels that didn't finish this
// channel's files (the owner can't finish it) while an earlier set did. Then the finished set, so the card offers its
// drafts instead of a dead end.
function cardRun(runs) {
  const newest = runs[0] || null;
  if (newest?.shared && UNFINISHED.has(newest.status)) return runs.find((run) => run.status === 'succeeded') || newest;
  return newest;
}

// The channel owner's whole studio: their channel, the ready trends with their channel's answer and latest set, and only
// their channel's runs and files. memberSince is null on the Mac and while an admin previews, so nothing is "earlier" there.
function buildChannelView({ contentStudio = {}, adoptions = [], channelId = null, editionId = 'general', viewerId = '', memberSince = null } = {}) {
  const folder = kit.kitFolders(editionId).find((entry) => entry.id === channelId);
  const channel = { id: channelId || '', name: folder?.name || 'Your channel', short: folder?.short || '', deliverables: (folder?.deliverableIds || []).map((id) => ({ id, label: descriptorOf(id)?.label || id, kind: descriptorOf(id)?.kind || 'text' })) };
  const workspaceId = contentStudio.activeWorkspaceId || '';
  const kitRuns = folder ? list(contentStudio.contentRuns).filter((run) => run?.kit && kitChannelIds(run, editionId).includes(channelId)).sort(newestFirst('createdAt')) : [];
  const runs = kitRuns.map((run) => publicKitRun(run, channelId, editionId));
  const themeOfRun = new Map(kitRuns.map((run) => [run.id, run.kit.themeId || null]));
  const assets = list(contentStudio.assets).filter((asset) => themeOfRun.has(asset.runId) && folderOf(asset.deliverableId, editionId) === channelId).sort(newestFirst('createdAt'))
    .map((asset) => ({ id: asset.id, runId: asset.runId, themeId: themeOfRun.get(asset.runId), deliverableId: asset.deliverableId, title: asset.title || '', kind: asset.kind || 'text', format: asset.format || '', createdAt: asset.createdAt || '', variantIndex: Number.isInteger(asset.variantIndex) ? asset.variantIndex : null, edited: editedOf(asset), status: ASSET_STATUSES.has(asset.reviewStatus) ? asset.reviewStatus : 'draft', link: asset.review?.status === 'published' && typeof asset.review.link === 'string' ? asset.review.link : '' }));
  // Sets and file counts per trend, grouped once (newest first, as runs are).
  const runsByTheme = new Map(); const assetCounts = new Map();
  for (const run of runs) { const key = run.kit.themeId; let rows = runsByTheme.get(key); if (!rows) { rows = []; runsByTheme.set(key, rows); } rows.push(run); }
  for (const asset of assets) assetCounts.set(asset.themeId, (assetCounts.get(asset.themeId) || 0) + 1);
  const answers = new Map(list(adoptions).filter((row) => row && row.channelId === channelId && (!row.workspaceId || !workspaceId || row.workspaceId === workspaceId)).map((row) => [row.themeId, row]));
  const since = time(memberSince);
  const channelName = (id) => kit.kitFolders(editionId).find((entry) => entry.id === id)?.name || id;
  const trends = readyTrends(contentStudio).map((trend) => {
    const answer = answers.get(trend.themeId);
    const adoption = answer ? { status: answer.status, link: answer.link || '', note: answer.note || '', plannedFor: typeof answer.plannedFor === 'string' ? answer.plannedFor : '', at: answer.at || answer.updatedAt || null, byName: answer.by?.name || '', byMe: Boolean(viewerId) && answer.by?.id === viewerId } : null;
    const earlier = !adoption && Number.isFinite(since) && time(trend.readyAt) < since - EARLIER_MS;
    const own = runsByTheme.get(trend.themeId) || [];
    // Routing: a trend sent to other channels only stays on the list (under All) but isn't new for this one.
    const routed = list(trend.decidedBy?.channels); const offered = !routed.length || routed.includes(channelId); const forUs = routed.includes(channelId);
    const decided = trend.decidedBy;
    return {
      themeId: trend.themeId, name: trend.name, description: trend.description, priority: trend.priority, category: trend.category, evidenceCount: trend.evidenceCount, readyAt: trend.readyAt,
      primaryReportId: trend.primaryReportId, reportAssets: trend.reportAssets, adoption, isNew: !adoption && !earlier && offered, earlier, briefEditedAt: trend.briefEditedAt,
      latestRun: cardRun(own), runCount: own.length, assetCount: assetCounts.get(trend.themeId) || 0,
      offered, forUs,
      decidedBy: decided ? { name: decided.name, at: decided.at, auto: decided.auto } : null,
      suggestion: decided && (decided.note || routed.length) ? { byName: decided.auto ? '' : decided.name, at: decided.at, note: decided.note, channels: routed.map((id) => ({ id, name: channelName(id) })) } : null,
    };
  });
  return { channel, counts: { newTrends: trends.filter((trend) => trend.isNew).length }, trends, runs, assets };
}

module.exports = { kitChannelIds, publicKitRun, readyTrends, buildChannelView, channelOf };
