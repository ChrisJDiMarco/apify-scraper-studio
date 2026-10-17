// Library tree: every studio file in one folder structure, filed the way people look for it.
//   Research run (or quick scan) → trend → its Trends report and Editorial toolkit, Channel assets (a folder per set,
//   a folder per channel team inside), Drafts made from it, and its Pictures.
//   Then Other sources (sets from Google Docs, files and pasted text), Drafts without a trend, and Pictures.
// Pure and renderer-side, like trend-board.js: no React, no I/O. Both layouts and Ask AI's folder links use it, so the
// grouping lives here once.
import KIT from './kit-folders.json';

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; };
const newestFirst = (a, b) => time(b.createdAt) - time(a.createdAt);
const count = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const plural = (value, word, many = `${word}s`) => `${count(value)} ${Number(value) === 1 ? word : many}`;
const ACTIVE = new Set(['queued', 'running']);
const WAITING = new Set(['queued', 'running', 'awaiting-review']);
const REPORT_TYPES = { 'evidence-report': 'trend-report', 'editorial-toolkit': 'toolkit' };
const TIER_RANK = { 'FAST-TRACK': 0, STRONG: 1, MONITOR: 2, LOW: 3 };

export const LIBRARY_TYPES = Object.freeze([
  { id: 'trend-report', label: 'Trends reports' },
  { id: 'toolkit', label: 'Editorial toolkits' },
  { id: 'channel-asset', label: 'Channel assets' },
  { id: 'draft', label: 'Drafts' },
  { id: 'picture', label: 'Pictures' },
]);
export const TYPE_LABEL = Object.freeze({ 'trend-report': 'Trends report', toolkit: 'Editorial toolkit', 'channel-asset': 'Channel asset', draft: 'Draft', picture: 'Picture', legacy: 'Earlier board item' });
// Reports aren't channel assets, but the channel filter still finds them under the deliverable channel they carry.
export const REPORT_CHANNELS = Object.freeze([{ id: 'research', name: 'Research' }, { id: 'strategy', name: 'Strategy' }]);
export const SOURCE_LABEL = Object.freeze({ trend: 'From a trends report', report: 'From a report', 'google-doc': 'From a Google Doc', file: 'From a document', text: 'From pasted text' });

// A deliverable's channel team comes from its id, never from a folder's display name, exactly as channel-view.js's
// channelOf does in the main process (test/library-tree.test.js keeps the two in step). An edition that doesn't offer a
// deliverable files it under 'other'.
const FOLDER_ORDER = new Map(KIT.folders.map((folder, index) => [folder.id, index]));
const CHANNEL_INDEX = new Map(KIT.folders.flatMap((folder) => folder.deliverables.map((id) => [id, folder.id])));
const offered = (deliverableId, editionId) => { const only = KIT.editionOnly?.[deliverableId]; return !only || only.includes(editionId || 'general'); };
export function channelOf(deliverableId, editionId = 'general') {
  return (offered(deliverableId, editionId) && CHANNEL_INDEX.get(deliverableId)) || 'other';
}
const editionKey = (editionId) => (editionId === 'semrush' ? 'semrush' : 'general');
export function channelName(channelId, editionId = 'general') {
  const folder = KIT.folders.find((row) => row.id === channelId);
  if (folder) return folder[editionKey(editionId)];
  return REPORT_CHANNELS.find((row) => row.id === channelId)?.name || 'Other';
}
// Channels people can filter by: this edition's channel teams, then the two report channels.
export function libraryChannels(editionId = 'general') {
  return [...KIT.folders.filter((folder) => folder.deliverables.some((id) => offered(id, editionId))).map((folder) => ({ id: folder.id, name: folder[editionKey(editionId)] })), ...REPORT_CHANNELS];
}
const channelOfFile = (deliverableId, editionId) => (deliverableId === 'evidence-report' ? 'research' : deliverableId === 'editorial-toolkit' ? 'strategy' : channelOf(deliverableId, editionId));

// Research reports carry "TREND:" and "— Comprehensive Trends Report" around the trend's name (as asset-kit.js cleanTitle).
export function cleanTitle(value) {
  return String(value || '').replace(/^\s*TREND:\s*/i, '').replace(/\s+—\s+Comprehensive Trends Report\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
// Newest first, in plain-language buckets (moved here from simple-mode.jsx so both layouts bucket alike).
export function dateGroup(value) {
  const then = new Date(value || 0); const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : days < 31 ? 'This month' : 'Earlier';
}
// "Oct 14" this year, "Oct 14, 2025" otherwise, in the viewer's locale.
export function dayLabel(value, now = Date.now()) {
  const date = new Date(value || ''); if (!value || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, date.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
const stampLabel = (value) => { const date = new Date(value || ''); return !value || Number.isNaN(date.getTime()) ? 'Undated' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
// A set of channel assets in one line (Simple Assets, folder cards and the Advanced tree say the same thing).
export function runSummary(run) {
  const jobs = list(run?.jobs); const total = jobs.length; const done = jobs.filter((job) => job.status === 'succeeded').length;
  if (run?.status === 'queued') return 'Starting…';
  if (run?.status === 'running') return `Making assets · ${done} of ${total} ready`;
  if (run?.status === 'succeeded') return `${plural(total, 'asset')} ready`;
  if (run?.status === 'cancelled') return `Stopped · ${done} of ${total} ready`;
  return `${done} of ${total} ready · ${total - done} need${total - done === 1 ? 's' : ''} another try`;
}
const windowLabel = (run) => {
  const hours = Number(run?.quickScan?.lookbackHours);
  if (Number.isFinite(hours) && hours > 0) return hours % 24 === 0 && hours > 24 ? `Last ${hours / 24} days` : `Last ${plural(hours, 'hour')}`;
  return run?.window?.startDate ? `${run.window.startDate} → ${run.window.endDate || 'Present'}` : '';
};
export const isQuickScan = (run) => run?.origin === 'quick-scan';

function emptyCounts() { return { trends: 0, files: 0, written: 0, pictures: 0, kits: 0, done: 0, total: 0 }; }

export function buildLibraryTree({ researchRuns = [], contentRuns = [], assets = [], themes = [], programs = [], editionId = '', helpImages = [], legacyAssets = [], adoptionsByTheme = {}, now = Date.now() } = {}) {
  const nodes = {}; const items = []; const itemsByKey = {}; const bySourceKey = {}; const byAssetId = {}; const rootIds = new Set();
  const runs = list(contentRuns).filter((run) => run && run.id);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const files = list(assets).filter((asset) => asset && asset.id);
  const assetById = new Map(files.map((asset) => [asset.id, asset]));
  const assetsByRun = new Map();
  for (const asset of files) { const rows = assetsByRun.get(asset.runId) || []; rows.push(asset); assetsByRun.set(asset.runId, rows); }
  const research = list(researchRuns).filter((run) => run && run.id);
  const researchById = new Map(research.map((run) => [run.id, run]));
  const programName = new Map(list(programs).map((program) => [program.id, program.name]));
  const repository = new Map(list(themes).map((theme) => [theme.id, theme]));
  const named = (id) => (editionId ? channelName(id, editionId) : '');
  // Unknown edition: group by the full folder table (it offers every deliverable) and show the names saved on each set.
  const groupEdition = editionId || 'semrush';

  function node(id, type, title, parentId = '', extra = {}) {
    if (nodes[id]) return nodes[id];
    const value = { id, type, title, subtitle: '', date: '', parentId, children: [], itemKeys: [], assetIds: [], status: '', live: false, liveText: '', counts: emptyCounts(), cover: [], meta: {}, ...extra };
    nodes[id] = value;
    if (parentId) nodes[parentId].children.push(id); else rootIds.add(id);
    return value;
  }
  // Every file is one item; an item can sit in more than one folder (a hero picture is in Social and in Pictures).
  function place(folder, asset, role, context = {}) {
    const key = `studio:${asset.id}`;
    let item = itemsByKey[key];
    if (!item) {
      const image = asset.kind === 'image' || asset.kind === 'video';
      const types = role === 'report' ? [REPORT_TYPES[asset.deliverableId] || 'draft'] : role === 'kit' ? (image ? ['channel-asset', 'picture'] : ['channel-asset']) : image ? (role === 'draft' ? ['draft', 'picture'] : ['picture']) : ['draft'];
      const channelId = channelOfFile(asset.deliverableId, groupEdition);
      item = {
        key, source: 'studio', id: asset.id, kind: image ? 'image' : 'text', type: image ? 'picture' : types[0], types, title: asset.title || (image ? 'Campaign visual' : 'Untitled draft'),
        deliverableId: asset.deliverableId || '', channelId, channelName: context.channelName || (REPORT_TYPES[asset.deliverableId] ? REPORT_CHANNELS.find((row) => row.id === channelId)?.name : named(channelId)) || text(asset.channel),
        label: context.label || (role === 'report' ? TYPE_LABEL[REPORT_TYPES[asset.deliverableId]] : text(asset.channel)) || '', createdAt: asset.createdAt || '', edited: asset.edited?.at ? asset.edited : null, reviewStatus: asset.reviewStatus || 'draft',
        runId: asset.runId || '', kitRunId: role === 'kit' ? asset.runId : '', trendNodeId: context.trendNodeId || '', variantIndex: Number.isInteger(asset.variantIndex) ? asset.variantIndex : null,
        nodeIds: [], context: [], haystack: '', asset,
      };
      itemsByKey[key] = item; items.push(item);
    }
    if (!item.nodeIds.includes(folder.id)) { item.nodeIds.push(folder.id); folder.itemKeys.push(key); folder.assetIds.push(asset.id); (byAssetId[asset.id] ||= []).push(folder.id); }
    if (!item.trendNodeId && context.trendNodeId) item.trendNodeId = context.trendNodeId;
    item.context.push(...list(context.words));
    return item;
  }

  // ---- Research runs and their trends -------------------------------------------------------------------------
  const listed = new Map(); // report run id → where its research run lists it
  for (const run of research) list(run.reportRunIds).forEach((entry, index) => { const runId = typeof entry === 'string' ? entry : entry?.runId; if (runId && !listed.has(runId)) listed.set(runId, { researchRunId: run.id, index }); });
  function researchNode(run) {
    const id = `research:${run.id}`; if (nodes[id]) return nodes[id];
    const quick = isQuickScan(run); const program = programName.get(run.programId) || '';
    const topic = text(run.quickScan?.topic).trim();
    const title = quick ? (topic ? `Quick scan · ${topic}` : run.title || 'Quick scan') : `${dayLabel(run.createdAt, now) || 'Undated'} · ${program || run.title || 'Research run'}`;
    return node(id, 'research-run', title, '', { subtitle: [quick ? dayLabel(run.createdAt, now) : program && run.title && run.title !== program ? run.title : '', windowLabel(run)].filter(Boolean).join(' · '), date: run.createdAt || '', status: run.status || '', meta: { researchRunId: run.id, programId: run.programId || '', programName: program, origin: quick ? 'quick-scan' : 'research', quickScan: quick ? run.quickScan || null : null } });
  }
  const earlierRoot = () => node('earlier', 'earlier', 'Earlier research', '', { subtitle: 'Trends whose research run is no longer in this workspace' });
  const trendNodes = new Map(); // `${researchRunId}:${themeId}` → node
  const trendOfReport = new Map(); // report or toolkit asset id → trend node id
  // Listed report runs first, in their research run's order, so the run a research run names for a trend is its primary.
  const reportRuns = runs.filter((run) => run.themeId && !run.kit).sort((a, b) => (listed.has(b.id) - listed.has(a.id)) || ((listed.get(a.id)?.index ?? 0) - (listed.get(b.id)?.index ?? 0)) || newestFirst(a, b));
  for (const run of reportRuns) {
    const researchRunId = run.researchRunId || listed.get(run.id)?.researchRunId || '';
    const parentRun = researchById.get(researchRunId);
    const key = `${researchRunId || 'none'}:${run.themeId}`;
    let trend = trendNodes.get(key);
    if (!trend) {
      const theme = list(parentRun?.themes).find((row) => row?.id === run.themeId) || list(parentRun?.discoveredThemes).find((row) => row?.id === run.themeId) || null;
      const tracked = repository.get(run.themeId) || {};
      const parent = parentRun ? researchNode(parentRun) : earlierRoot();
      const usedBy = Object.entries(adoptionsByTheme?.[run.themeId] || {}).filter(([, row]) => row?.status === 'using').map(([channelId, row]) => ({ channelId, name: row.channelName || named(channelId) || channelName(channelId) })).sort((a, b) => a.name.localeCompare(b.name));
      trend = node(`trend:${key}`, 'trend', cleanTitle(theme?.name || tracked.name || run.title) || 'Untitled trend', parent.id, {
        date: run.createdAt || '', status: run.status || '',
        meta: { researchRunId, themeId: run.themeId, reportRunId: run.id, reportAssetId: '', toolkitAssetId: '', priorityTier: theme?.scoring?.priorityTier || tracked.scoring?.priorityTier || '', evidenceCount: Number(theme?.evidenceCount ?? list(theme?.evidenceIds).length) || 0, aliases: list(theme?.aliases || tracked.aliases).filter((alias) => typeof alias === 'string'), usedBy },
      });
      trendNodes.set(key, trend);
    }
    if (ACTIVE.has(run.status)) { trend.live = true; trend.liveText ||= 'Writing the report…'; }
    const words = [trend.title, ...trend.meta.aliases, nodes[trend.parentId].title];
    const own = (assetsByRun.get(run.id) || []).sort((a, b) => (REPORT_TYPES[a.deliverableId] === 'trend-report' ? -1 : 0) - (REPORT_TYPES[b.deliverableId] === 'trend-report' ? -1 : 0) || newestFirst(a, b));
    for (const asset of own) {
      place(trend, asset, 'report', { trendNodeId: trend.id, words });
      if (REPORT_TYPES[asset.deliverableId]) trendOfReport.set(asset.id, trend.id);
      if (run.id === trend.meta.reportRunId && asset.deliverableId === 'evidence-report' && !trend.meta.reportAssetId) trend.meta.reportAssetId = asset.id;
      if (run.id === trend.meta.reportRunId && asset.deliverableId === 'editorial-toolkit' && !trend.meta.toolkitAssetId) trend.meta.toolkitAssetId = asset.id;
    }
  }
  // A draft made from a draft of a trend report still belongs to the trend: follow sources up to three hops from the
  // file being placed (its source is the first).
  function trendFor(assetId) {
    let id = assetId;
    for (let hop = 0; hop < 3 && id; hop += 1) {
      const found = trendOfReport.get(id); if (found) return found;
      const run = runById.get(assetById.get(id)?.runId);
      id = run ? run.kit?.reportAssetId || run.sourceAssetId || '' : '';
    }
    return '';
  }
  const newestTrendFor = (themeId) => [...trendNodes.values()].filter((trend) => trend.meta.themeId === themeId).sort((a, b) => time(b.date) - time(a.date))[0]?.id || '';

  // ---- Channel assets (kits) ---------------------------------------------------------------------------------
  const kits = runs.filter((run) => run.kit).sort(newestFirst);
  for (const run of kits) {
    const kit = run.kit; const sourceKey = text(kit.sourceKey) || `run:${run.id}`;
    const trendId = trendFor(kit.reportAssetId || run.sourceAssetId) || (kit.themeId ? newestTrendFor(kit.themeId) : '');
    let parent; let home;
    if (trendId) { home = nodes[trendId]; parent = node(`kits:${trendId}`, 'kits', 'Channel assets', trendId, { meta: { trendNodeId: trendId } }); }
    else {
      const others = node('other-sources', 'orphans', 'Other sources', '', { subtitle: 'Channel assets from Google Docs, files, pasted text and other reports' });
      home = node(`source:${sourceKey}`, 'source', cleanTitle(kit.sourceTitle || run.title) || 'Untitled source', others.id, { date: run.createdAt || '', meta: { sourceKey, sourceKind: kit.sourceKind || '', reportAssetId: kit.reportAssetId || '', sourceUrl: kit.sourceUrl || '', latestKitRunId: run.id } });
      parent = home;
    }
    const keyed = (bySourceKey[sourceKey] ||= []); if (!keyed.includes(home.id)) keyed.push(home.id);
    const live = ACTIVE.has(run.status);
    const kitNode = node(`kit:${run.id}`, 'kit-run', stampLabel(run.createdAt), parent.id, { subtitle: kit.folderName || '', date: run.createdAt || '', status: run.status || '', live, liveText: live ? runSummary(run) : '', meta: { kitRunId: run.id, sourceKey, sourceKind: kit.sourceKind || '', folderName: kit.folderName || '', reportAssetId: kit.reportAssetId || '', trendNodeId: trendId, summary: runSummary(run) } });
    const jobs = list(run.jobs); const own = assetsByRun.get(run.id) || [];
    kitNode.counts.done = jobs.filter((job) => job.status === 'succeeded').length; kitNode.counts.total = jobs.length;
    const jobIndex = new Map(jobs.map((job, index) => [job.id, index]));
    const channelIds = [...new Set([...jobs.map((job) => job.id), ...own.map((asset) => asset.deliverableId)].map((id) => channelOf(id, groupEdition)))].sort((a, b) => (FOLDER_ORDER.get(a) ?? 99) - (FOLDER_ORDER.get(b) ?? 99));
    for (const channelId of channelIds) {
      const channelJobs = jobs.filter((job) => channelOf(job.id, groupEdition) === channelId);
      // Grouped by id; the name is this edition's (or, when the edition isn't known, the one saved on the set).
      const name = named(channelId) || channelJobs.find((job) => job.folder)?.folder || channelName(channelId);
      const channelLive = live && channelJobs.some((job) => ACTIVE.has(job.status || 'queued'));
      const channel = node(`channel:${run.id}:${channelId}`, 'channel', name, kitNode.id, { date: run.createdAt || '', status: run.status || '', live: channelLive, liveText: channelLive ? 'Writing…' : '', meta: { channelId, kitRunId: run.id, deliverableIds: channelJobs.map((job) => job.id) } });
      channel.counts.done = channelJobs.filter((job) => job.status === 'succeeded').length; channel.counts.total = channelJobs.length;
      const labelOf = (asset) => channelJobs.find((job) => job.id === asset.deliverableId)?.label || '';
      const ordered = own.filter((asset) => channelOf(asset.deliverableId, groupEdition) === channelId).sort((a, b) => ((jobIndex.get(a.deliverableId) ?? 99) - (jobIndex.get(b.deliverableId) ?? 99)) || ((a.variantIndex ?? 0) - (b.variantIndex ?? 0)));
      for (const asset of ordered) place(channel, asset, 'kit', { trendNodeId: trendId, channelName: name, label: labelOf(asset), words: [home.title, nodes[home.parentId]?.title, name, labelOf(asset), kit.folderName, kit.sourceTitle] });
    }
  }

  // ---- Create content drafts ---------------------------------------------------------------------------------
  for (const run of runs.filter((row) => !row.kit && !row.themeId).sort(newestFirst)) {
    const own = (assetsByRun.get(run.id) || []).sort(newestFirst); const live = ACTIVE.has(run.status);
    if (!own.length && !live) continue;
    const trendId = run.sourceAssetId ? trendFor(run.sourceAssetId) : '';
    let folder;
    if (trendId) folder = node(`drafts:${trendId}`, 'drafts', 'Drafts', trendId, { subtitle: 'Made with Create content', meta: { trendNodeId: trendId, runIds: [] } });
    else { const root = node('loose-drafts', 'orphans', 'Drafts without a trend', '', { subtitle: 'Create content runs from a brief, a document or pasted text' }); folder = node(`draft-run:${run.id}`, 'draft-run', cleanTitle(run.title) || 'Content campaign', root.id, { subtitle: dayLabel(run.createdAt, now), date: run.createdAt || '', status: run.status || '', meta: { runIds: [] } }); }
    folder.meta.runIds.push(run.id);
    if (live) { folder.live = true; folder.liveText ||= 'Writing drafts…'; }
    const words = trendId ? [nodes[trendId].title, nodes[nodes[trendId].parentId]?.title, run.title] : [run.title];
    for (const asset of own) place(folder, asset, 'draft', { trendNodeId: trendId, words });
  }

  // ---- Quick scans: a folder only when something was made from them ------------------------------------------
  for (const run of research.filter((row) => isQuickScan(row))) {
    const own = assetsByRun.get(run.id) || [];
    if (!own.length) continue;
    const folder = researchNode(run);
    for (const asset of own) place(folder, asset, 'draft', { words: [folder.title] });
  }

  // ---- Files nothing else claims (their run is gone), every picture, Ask AI's pictures, the earlier board -----
  const loose = files.filter((asset) => !itemsByKey[`studio:${asset.id}`]).sort(newestFirst);
  if (loose.length) { const folder = node('other-files', 'orphans', 'Other files', '', { subtitle: 'Saved files whose run is no longer in this workspace' }); for (const asset of loose) place(folder, asset, 'loose', { words: [] }); }
  const images = items.filter((item) => item.source === 'studio' && item.kind === 'image').sort(newestFirst);
  const askImages = list(helpImages).filter((image) => image && image.id);
  if (images.length || askImages.length) {
    const pictures = node('pictures', 'pictures', 'Pictures', '', { subtitle: 'Every picture in the studio, newest first' });
    for (const item of images) place(pictures, item.asset, item.kitRunId ? 'kit' : 'draft', { words: ['picture'] });
    if (askImages.length) {
      const ask = node('pictures:ask', 'askai', 'Made in Ask AI', pictures.id, { subtitle: 'Ask AI pictures are shared across workspaces' });
      for (const image of [...askImages].sort(newestFirst)) {
        const key = `help:${image.id}`;
        const item = { key, source: 'help', id: image.id, kind: 'image', type: 'picture', types: ['picture'], title: image.title || 'Ask AI picture', deliverableId: '', channelId: '', channelName: '', label: 'Made in Ask AI', createdAt: image.createdAt || '', edited: null, reviewStatus: '', runId: '', kitRunId: '', trendNodeId: '', variantIndex: null, nodeIds: [ask.id], context: ['ask ai', text(image.prompt)], haystack: '', prompt: text(image.prompt), size: text(image.size), asset: null };
        itemsByKey[key] = item; items.push(item); ask.itemKeys.push(key);
      }
    }
  }
  const legacy = list(legacyAssets).filter((row) => row && row.id);
  if (legacy.length) {
    const board = node('legacy', 'legacy', 'From the earlier content board', '', { subtitle: 'Kept so nothing is lost; new work flows through the Trend board and Create content' });
    for (const row of legacy) {
      const key = `legacy:${row.id}`; if (itemsByKey[key]) continue;
      const item = { key, source: 'legacy', id: row.id, kind: 'text', type: 'legacy', types: ['legacy'], title: row.title || 'Untitled item', deliverableId: '', channelId: '', channelName: text(row.channel), label: TYPE_LABEL.legacy, createdAt: row.createdAt || row.updatedAt || '', edited: null, reviewStatus: text(row.status), runId: '', kitRunId: '', trendNodeId: '', variantIndex: null, nodeIds: [board.id], context: [text(row.channel)], haystack: '', asset: null };
      itemsByKey[key] = item; items.push(item); board.itemKeys.push(key);
    }
  }

  // ---- Trend sub-folders that gather from the rest: each trend's own Pictures --------------------------------
  for (const trend of trendNodes.values()) {
    const under = (id) => [nodes[id], ...nodes[id].children.flatMap(under)];
    const pictures = [...new Set(under(trend.id).flatMap((row) => row.itemKeys))].map((key) => itemsByKey[key]).filter((item) => item.kind === 'image').sort(newestFirst);
    if (!pictures.length) continue;
    const folder = node(`pictures:${trend.id}`, 'pictures', 'Pictures', trend.id, { meta: { trendNodeId: trend.id } });
    for (const item of pictures) place(folder, item.asset, item.kitRunId ? 'kit' : 'draft', {});
  }

  // ---- Order, counts, live state and covers -------------------------------------------------------------------
  const tierRank = (id) => TIER_RANK[nodes[id].meta.priorityTier] ?? 4;
  for (const value of Object.values(nodes)) {
    if (value.type === 'research-run') value.children.sort((a, b) => tierRank(a) - tierRank(b)); // stable: reportRunIds order breaks ties
    if (value.type === 'earlier') value.children.sort((a, b) => time(nodes[b].date) - time(nodes[a].date));
    if (value.type === 'trend') {
      const rank = { kits: 0, drafts: 1, pictures: 2 }; value.children.sort((a, b) => (rank[nodes[a].type] ?? 3) - (rank[nodes[b].type] ?? 3));
      // The run the research run names may still be writing; an earlier pair of the same trend stands in meanwhile.
      const docs = value.itemKeys.map((key) => itemsByKey[key]);
      value.meta.reportAssetId ||= docs.find((item) => item.type === 'trend-report')?.id || '';
      value.meta.toolkitAssetId ||= docs.find((item) => item.type === 'toolkit')?.id || '';
    }
  }
  const keysUnder = new Map();
  function gather(id) {
    if (keysUnder.has(id)) return keysUnder.get(id);
    const value = nodes[id]; const keys = new Set(value.itemKeys);
    for (const child of value.children) { for (const key of gather(child)) keys.add(key); const below = nodes[child]; if (below.live) { value.live = true; value.liveText ||= below.liveText; } value.counts.trends += below.counts.trends + (below.type === 'trend' ? 1 : 0); value.counts.kits += below.counts.kits + (below.type === 'kit-run' ? 1 : 0); }
    if (value.type === 'research-run' && ACTIVE.has(value.status)) { value.live = true; value.liveText ||= 'Writing reports…'; }
    const rows = [...keys].map((key) => itemsByKey[key]);
    value.counts.files = rows.length; value.counts.pictures = rows.filter((item) => item.kind === 'image').length; value.counts.written = value.counts.files - value.counts.pictures;
    value.cover = rows.filter((item) => item.source === 'studio' && item.kind === 'image').sort(newestFirst).slice(0, 3).map((item) => item.id);
    if (!value.date) value.date = rows.map((item) => item.createdAt).sort((a, b) => time(b) - time(a))[0] || '';
    keysUnder.set(id, keys);
    return keys;
  }
  for (const id of rootIds) gather(id);
  for (const item of items) {
    const path = [];
    for (let id = item.nodeIds[0]; id && nodes[id]; id = nodes[id].parentId) path.unshift(nodes[id].title);
    item.location = item.nodeIds[0] || '';
    item.haystack = [...new Set([item.title, cleanTitle(item.title), item.label, item.channelName, TYPE_LABEL[item.type], ...path, ...item.context].map((value) => String(value || '').toLowerCase().trim()).filter(Boolean))].join(' \n');
    delete item.context;
  }
  // Research runs still collecting or waiting for review have no files yet; the Library says how many.
  const pending = research.filter((run) => !isQuickScan(run) && !nodes[`research:${run.id}`] && WAITING.has(run.status)).map((run) => ({ runId: run.id, title: programName.get(run.programId) || run.title || 'Research run', status: run.status, createdAt: run.createdAt || '' }));
  const fixed = ['earlier', 'other-sources', 'loose-drafts', 'other-files', 'pictures', 'legacy'];
  const roots = [...[...rootIds].filter((id) => nodes[id].type === 'research-run').sort((a, b) => time(nodes[b].date) - time(nodes[a].date)), ...fixed.filter((id) => rootIds.has(id))];
  return { nodes, roots, items: items.sort(newestFirst), itemsByKey, bySourceKey, byAssetId, pending };
}

// The breadcrumb: the nodes from the root down to this one.
export function pathTo(tree, nodeId) {
  const path = [];
  for (let id = nodeId, guard = 0; id && tree?.nodes?.[id] && guard < 64; id = tree.nodes[id].parentId, guard += 1) path.unshift(tree.nodes[id]);
  return path;
}

// "Oct 14" style dates match whole days in the viewer's time zone; ISO stamps match exactly.
const dayStart = (value) => { const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime() : time(value); };
// Search and filters across everything at once: flat results, newest first, each with the folders it sits in.
export function filterLibrary(tree, { query = '', types = [], channels = [], from = '', to = '' } = {}) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wantTypes = new Set(list(types)); const wantChannels = new Set(list(channels));
  const start = from ? dayStart(from) : 0; const end = to ? (/^\d{4}-\d{2}-\d{2}$/.test(to) ? dayStart(to) + 86400000 - 1 : time(to)) : 0;
  const active = Boolean(terms.length || wantTypes.size || wantChannels.size || start || end);
  const matches = list(tree?.items).filter((item) => (!terms.length || terms.every((term) => item.haystack.includes(term)))
    && (!wantTypes.size || item.types.some((type) => wantTypes.has(type)))
    && (!wantChannels.size || wantChannels.has(item.channelId))
    && (!start || time(item.createdAt) >= start) && (!end || (time(item.createdAt) && time(item.createdAt) <= end)));
  const counts = {}; const expand = new Set();
  for (const item of matches) for (const node of pathTo(tree, item.location)) { counts[node.id] = (counts[node.id] || 0) + 1; expand.add(node.id); }
  return { active, items: matches.map((item) => ({ ...item, path: pathTo(tree, item.location) })), counts, expand };
}

// Simple Reports: one entry per trend (its Trends report and Editorial toolkit together), in Library order.
export function groupReports(tree) {
  const entries = [];
  function visit(id, group) {
    const value = tree?.nodes?.[id]; if (!value) return;
    if (value.type === 'trend') {
      const docs = value.itemKeys.map((key) => tree.itemsByKey[key]).filter((item) => item && ['trend-report', 'toolkit'].includes(item.type));
      if (!docs.length) return;
      const report = docs.find((item) => item.id === value.meta.reportAssetId) || docs.find((item) => item.type === 'trend-report') || null;
      const toolkit = docs.find((item) => item.id === value.meta.toolkitAssetId) || docs.find((item) => item.type === 'toolkit') || null;
      const kits = tree.nodes[`kits:${value.id}`];
      const edits = docs.map((item) => item.edited).filter((row) => row?.at).sort((a, b) => time(b.at) - time(a.at));
      entries.push({ key: value.id, nodeId: value.id, title: value.title, themeId: value.meta.themeId || '', priorityTier: value.meta.priorityTier || '', groupId: group?.id || '', groupTitle: group?.title || 'Earlier research', groupDate: group?.date || '', reportId: report?.id || '', toolkitId: toolkit?.id || '', primaryId: (report || toolkit).id, assetIds: docs.map((item) => item.id), createdAt: [report, toolkit].filter(Boolean).map((item) => item.createdAt).sort((a, b) => time(b) - time(a))[0] || value.date, edited: edits[0] || null, status: value.status, live: value.live, channelAssets: { nodeId: kits?.id || '', files: kits?.counts.files || 0, kits: kits?.counts.kits || 0, live: Boolean(kits?.live) } });
      return;
    }
    if (value.type === 'research-run' || value.type === 'earlier') for (const child of value.children) visit(child, value);
  }
  for (const id of list(tree?.roots)) visit(id, null);
  return entries;
}

// The count line under a folder's name, the same in both layouts.
export function folderSummary(value, now = Date.now()) {
  if (!value) return '';
  const c = value.counts;
  switch (value.type) {
    case 'research-run': return [plural(c.trends, 'trend'), plural(c.files, 'file'), c.pictures ? plural(c.pictures, 'picture') : '', value.meta.origin === 'quick-scan' ? '' : dayLabel(value.date, now)].filter(Boolean).join(' · ');
    case 'trend': { const docs = [value.meta.reportAssetId, value.meta.toolkitAssetId].filter(Boolean).length; return [docs === 2 ? 'Report + toolkit' : value.meta.reportAssetId ? 'Trends report' : value.meta.toolkitAssetId ? 'Editorial toolkit' : 'Report not written yet', c.kits ? plural(c.kits, 'asset set') : '', plural(c.files, 'file')].filter(Boolean).join(' · '); }
    case 'kits': return [plural(c.kits, 'set'), plural(c.files, 'file')].join(' · ');
    case 'kit-run': return value.meta.summary || '';
    case 'channel': return `${count(c.done)}/${count(c.total)} ready`;
    case 'drafts': case 'draft-run': return plural(c.written, 'draft') + (c.pictures ? ` · ${plural(c.pictures, 'picture')}` : '');
    case 'pictures': case 'askai': return plural(c.pictures, 'picture');
    case 'source': return [SOURCE_LABEL[value.meta.sourceKind] || 'From a report', plural(c.kits, 'set'), plural(c.files, 'file')].join(' · ');
    case 'earlier': return plural(c.trends, 'trend');
    case 'legacy': return plural(value.itemKeys.length, 'item');
    case 'orphans': return value.id === 'other-sources' ? plural(value.children.length, 'source') : value.id === 'loose-drafts' ? plural(value.children.length, 'campaign') : plural(c.files, 'file');
    default: return plural(c.files, 'file');
  }
}
