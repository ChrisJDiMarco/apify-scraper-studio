'use strict';
// Trend analytics for admins: which trends were found and approved, which got a brief, and which channels used them.
// Pure CommonJS. "Ready" comes from channel-view's readyTrends, so it means exactly what the Trends board means.
// Windows are UTC days: "7 days" is today (UTC) and the six days before it.
const kit = require('../shared/asset-kit');
const { readyTrends, channelOf } = require('./channel-view');

const DAY_MS = 86400000;
// A trend counts as offered to a channel when it was routed there (or to every channel) and its brief was ready no more
// than 14 days before the channel's first owner joined; older briefs sit in the owner's "Earlier" group and don't count
// against them.
const OFFER_GRACE_MS = 14 * DAY_MS;
const RANGES = [7, 30, 90, 365];
const PRIORITY = Object.freeze({ 'FAST-TRACK': 'top', STRONG: 'strong', MONITOR: 'watch' });
const ROLE_WORDS = Object.freeze({ admin: 'an admin', editor: 'an editor', channel: 'a channel owner' });
const list = (value) => (Array.isArray(value) ? value : []);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const latest = (values) => values.filter((value) => Number.isFinite(time(value))).sort((a, b) => time(b) - time(a))[0] || null;
const earliest = (values) => values.filter((value) => Number.isFinite(time(value))).sort((a, b) => time(a) - time(b))[0] || null;
const discoveredOf = (run) => (list(run?.discoveredThemes).length ? run.discoveredThemes : list(run?.themes));
const quote = (text) => (text ? `“${String(text)}”` : 'a trend');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const joinNames = (names) => (names.length <= 1 ? names[0] || '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The decision one research run recorded for a theme. Before review finishes it is that run's per-theme decision;
// afterwards the approved list is authoritative, as on the Trends board. 'pending' means this run didn't decide it.
function decisionIn(run, themeId) {
  if (!run) return 'pending';
  if (run.status !== 'awaiting-review' && run.approvedAt) return list(run.themes).some((theme) => theme?.id === themeId) ? 'approved' : 'passed';
  const decision = run.decisions?.[themeId];
  return decision === 'approved' || decision === 'passed' ? decision : 'pending';
}

function buildTrendAnalytics({ contentStudio = {}, adoptions = [], activity = [], members = [], editionId, workspace = null, now = new Date(), days = 90, includeAll = false } = {}) {
  const nowMs = new Date(now).getTime();
  const range = RANGES.includes(Number(days)) ? Number(days) : 90;
  const today = new Date(nowMs);
  const since = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (range - 1) * DAY_MS;
  const inWindow = (value) => time(value) >= since && time(value) <= nowMs;
  const space = workspace || list(contentStudio.workspaces).find((entry) => entry.id === contentStudio.activeWorkspaceId) || {};
  const workspaceId = space.id || contentStudio.activeWorkspaceId || '';
  const edition = editionId || space.editionId || 'general';
  const folders = kit.kitFolders(edition);
  const folderOf = (deliverableId) => channelOf(deliverableId, edition);
  const channelName = (id) => folders.find((folder) => folder.id === id)?.name || 'another channel';

  // Channels and their owners: enabled channel owners; ownerSince is the earliest owner's createdAt.
  const channels = folders.map((folder) => {
    // Owners by role base, so a custom role built on the channel base owns its channel too.
    const owners = list(members).filter((member) => member && (member.role === 'channel' || member.base === 'channel') && member.channelId === folder.id && !member.disabled);
    return { id: folder.id, name: folder.name, short: folder.short, owners: owners.map((member) => ({ id: member.id, name: member.name || '' })), ownerSince: earliest(owners.map((member) => member.createdAt)) };
  });

  // Answers in this workspace, by trend and channel.
  const answers = new Map();
  for (const row of list(adoptions)) if (row && (!row.workspaceId || !workspaceId || row.workspaceId === workspaceId) && (row.status === 'using' || row.status === 'not-using')) answers.set(`${row.themeId}|${row.channelId}`, row);
  const answer = (themeId, channelId) => answers.get(`${themeId}|${channelId}`) || null;

  // Drafts per trend and channel: a succeeded job of that channel in a kit run made from the trend, and the files kept.
  const kitRuns = list(contentStudio.contentRuns).filter((run) => run?.kit);
  const made = new Map();
  for (const run of kitRuns) {
    if (!run.kit.themeId) continue;
    for (const job of list(run.jobs)) {
      if (job.status !== 'succeeded') continue;
      const key = `${run.kit.themeId}|${folderOf(job.id)}`; const previous = made.get(key);
      if (!previous || time(run.createdAt) > time(previous.at)) made.set(key, { at: run.createdAt || null, byName: run.createdBy?.name || '' });
    }
  }
  const themeOfRun = new Map(kitRuns.map((run) => [run.id, run.kit.themeId || null]));
  const kitAssets = list(contentStudio.assets).filter((asset) => themeOfRun.has(asset.runId));
  const assetCounts = new Map();
  for (const asset of kitAssets) { const themeId = themeOfRun.get(asset.runId); if (!themeId) continue; const key = `${themeId}|${folderOf(asset.deliverableId)}`; assetCounts.set(key, (assetCounts.get(key) || 0) + 1); }

  // Every trend: the theme repository, plus any ready trend it lacks (records from before the repository existed).
  const ready = new Map(readyTrends(contentStudio).map((trend) => [trend.themeId, trend]));
  const researchRuns = list(contentStudio.researchRuns);
  const themes = new Map(list(contentStudio.themes).filter((theme) => theme?.id).map((theme) => [theme.id, theme]));
  for (const trend of ready.values()) if (!themes.has(trend.themeId)) themes.set(trend.themeId, { id: trend.themeId, name: trend.name });
  const info = new Map([...themes.values()].map((theme) => {
    const runs = researchRuns.filter((run) => discoveredOf(run).some((entry) => entry?.id === theme.id)).sort((a, b) => (time(b.createdAt) || 0) - (time(a.createdAt) || 0));
    // The decision comes from the newest run that recorded one, so a theme found again by a run still waiting for review
    // keeps its earlier answer. A trend whose brief was written without a recorded decision (older records) was approved.
    const newest = runs[0] || null; const deciding = runs.find((run) => decisionIn(run, theme.id) !== 'pending') || null;
    const decision = deciding ? decisionIn(deciding, theme.id) : ready.has(theme.id) ? 'approved' : 'pending'; const by = deciding?.decisionsBy?.[theme.id];
    const discovered = newest ? discoveredOf(newest).find((entry) => entry?.id === theme.id) : null;
    const tier = theme.scoring?.priorityTier || ready.get(theme.id)?.priorityTier || discovered?.scoring?.priorityTier || '';
    const firstDetectedAt = theme.firstDetectedAt || earliest(runs.map((run) => run.createdAt));
    const routedTo = decision === 'approved' ? list(by?.channels).filter((id) => typeof id === 'string') : [];
    return [theme.id, { themeId: theme.id, name: ready.get(theme.id)?.name || theme.name || discovered?.name || 'Untitled trend', firstDetectedAt, decision, decidedBy: decision !== 'pending' && by ? { name: by.name || '', at: by.at || null, ...(by.note ? { note: String(by.note) } : {}) } : null, routedTo, priority: PRIORITY[tier] || null }];
  }));
  // Routing comes from the decision on the run that made the brief ready (readyTrends), else the trend's newest decision.
  const routedTo = (trend) => (trend?.decidedBy ? list(trend.decidedBy.channels) : list(info.get(trend?.themeId)?.routedTo));
  const offeredTo = (trend, channel) => Boolean(trend) && channel.ownerSince != null && time(trend.readyAt) >= time(channel.ownerSince) - OFFER_GRACE_MS && (!routedTo(trend).length || routedTo(trend).includes(channel.id));

  const found = [...info.values()].filter((theme) => inWindow(theme.firstDetectedAt));
  const briefs = [...ready.values()].filter((trend) => inWindow(trend.readyAt));
  const usingAnswers = (themeId) => channels.map((channel) => answer(themeId, channel.id)).filter((row) => row?.status === 'using');
  const totals = {
    trendsFound: found.length,
    approved: found.filter((theme) => theme.decision === 'approved').length,
    passed: found.filter((theme) => theme.decision === 'passed').length,
    pending: found.filter((theme) => theme.decision === 'pending').length,
    briefsReady: briefs.length,
    inUse: briefs.filter((trend) => usingAnswers(trend.themeId).length).length,
    linksAdded: briefs.reduce((sum, trend) => sum + usingAnswers(trend.themeId).filter((row) => row.link).length, 0),
    assetsGenerated: kitAssets.filter((asset) => inWindow(asset.createdAt)).length,
  };

  // Matrix rows: briefs ready in the window; includeAll adds trends found in the window that have no brief yet.
  const rowIds = new Set(briefs.map((trend) => trend.themeId));
  if (includeAll) for (const theme of found) if (!ready.has(theme.themeId)) rowIds.add(theme.themeId);
  const trends = [...rowIds].map((themeId) => {
    const theme = info.get(themeId); const trend = ready.get(themeId) || null;
    const cells = Object.fromEntries(channels.map((channel) => {
      const key = `${themeId}|${channel.id}`; const reply = answer(themeId, channel.id); const drafts = made.get(key);
      return [channel.id, { status: reply ? reply.status : drafts ? 'generated' : 'none', link: reply?.link || '', byName: reply ? reply.by?.name || '' : drafts?.byName || '', at: reply ? reply.at || reply.updatedAt || null : drafts?.at || null, assetCount: assetCounts.get(key) || 0, offered: offeredTo(trend, channel) }];
    }));
    return { themeId, name: theme.name, firstDetectedAt: theme.firstDetectedAt, readyAt: trend?.readyAt || null, decision: theme.decision, decidedBy: theme.decidedBy, routedTo: trend ? routedTo(trend) : theme.routedTo, ready: Boolean(trend), priority: theme.priority, cells };
  }).sort((a, b) => (time(b.readyAt) || 0) - (time(a.readyAt) || 0) || (time(b.firstDetectedAt) || 0) - (time(a.firstDetectedAt) || 0) || a.name.localeCompare(b.name));

  // Per channel, over the briefs ready in the window that were offered to it. The four answer buckets add up to offered.
  const byChannel = channels.map((channel) => {
    const offered = briefs.filter((trend) => offeredTo(trend, channel));
    let using = 0; let notUsing = 0; let generatedOnly = 0;
    for (const trend of offered) { const reply = answer(trend.themeId, channel.id); if (reply?.status === 'using') using++; else if (reply?.status === 'not-using') notUsing++; else if (made.has(`${trend.themeId}|${channel.id}`)) generatedOnly++; }
    const activityAt = list(activity).filter((row) => row?.detail && (row.detail.channelId === channel.id || list(row.detail.channels).includes(channel.id))).map((row) => row.at);
    const answeredAt = list(adoptions).filter((row) => row?.channelId === channel.id && (!row.workspaceId || !workspaceId || row.workspaceId === workspaceId)).map((row) => row.updatedAt || row.at);
    const runAt = kitRuns.filter((run) => list(run.jobs).some((job) => folderOf(job.id) === channel.id)).map((run) => run.updatedAt || run.createdAt);
    return {
      id: channel.id, name: channel.name, short: channel.short, owners: channel.owners, offered: offered.length, using, notUsing, generatedOnly,
      noAnswer: channel.owners.length ? offered.length - using - notUsing - generatedOnly : null,
      assets: kitAssets.filter((asset) => folderOf(asset.deliverableId) === channel.id && inWindow(asset.createdAt)).length,
      lastActivityAt: latest([...activityAt, ...answeredAt, ...runAt]),
    };
  });

  // Recent activity in plain words, newest first; studio-wide rows (people, links) show in every workspace.
  const trendName = (detail) => detail.trendName || detail.sourceTitle || info.get(detail.themeId)?.name || '';
  const recent = list(activity).filter((row) => row && (!row.workspaceId || !workspaceId || row.workspaceId === workspaceId))
    .sort((a, b) => (time(b.at) || 0) - (time(a.at) || 0)).slice(0, 50)
    .map((row) => ({ at: row.at || null, byName: row.by?.name || 'Someone', kind: row.kind, text: describe(row, { trendName, channelName }) }));

  return { generatedAt: new Date(nowMs).toISOString(), days: range, since: new Date(since).toISOString(), workspace: { id: workspaceId, name: space.name || '' }, channels, totals, trends, byChannel, recent };
}

// One activity row as a sentence, e.g. "Alex marked “AI Overviews” as used for Semrush Blog".
function describe(row, { trendName, channelName }) {
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {}; const who = row.by?.name || 'Someone';
  const trend = quote(trendName(detail)); const person = detail.name || 'someone';
  switch (row.kind) {
    case 'trend-decision': {
      if (Number.isFinite(detail.approved) || Number.isFinite(detail.passed)) {
        const parts = [Number(detail.approved) > 0 && `approved ${plural(Number(detail.approved), 'trend')}`, Number(detail.passed) > 0 && `skipped ${plural(Number(detail.passed), 'trend')}`].filter(Boolean);
        return `${who} ${parts.length ? parts.join(' and ') : 'reviewed the trends'}`;
      }
      if (detail.decision === 'approved') return `${who} approved ${trend}`;
      if (detail.decision === 'passed') return `${who} skipped ${trend}`;
      return `${who} put ${trend} back up for review`;
    }
    case 'adoption': {
      const channel = channelName(detail.channelId);
      if (detail.status === 'using') return `${who} marked ${trend} as used for ${channel}${detail.link ? ' and added the link' : ''}`;
      if (detail.status === 'not-using') return `${who} said ${trend} isn’t for ${channel}`;
      return `${who} cleared the answer on ${trend} for ${channel}`;
    }
    case 'kit-created': {
      const names = list(detail.channels).map(channelName);
      return `${who} generated drafts of ${trend}${names.length ? ` for ${names.length > 3 ? plural(names.length, 'channel') : joinNames(names)}` : ''}`;
    }
    case 'report-edited': return `${who} edited ${quote(detail.title || trendName(detail))}`;
    case 'report-restored': return `${who} restored the original of ${quote(detail.title || trendName(detail))}`;
    case 'member-changed': {
      if (detail.action === 'removed') return `${who} removed ${person}`;
      const as = detail.role === 'channel' && detail.channelId ? `a channel owner for ${channelName(detail.channelId)}` : ROLE_WORDS[detail.role] || '';
      if (detail.action === 'added') return `${who} added ${person}${as ? ` as ${as}` : ''}`;
      if (detail.action === 'disabled') return `${who} paused ${person}’s access`;
      if (detail.action === 'enabled') return `${who} turned ${person}’s access back on`;
      return `${who} changed ${person}’s access${as ? ` to ${as}` : ''}`;
    }
    case 'link-issued': return `${who} made a new sign-in link for ${person}`;
    case 'research-started': return detail.origin === 'quick-scan' ? `${who} ran a quick scan on ${quote(detail.topic || 'a topic')}` : `${who} started a search with ${quote(detail.programName || 'a research program')}`;
    default: return `${who} made a change`;
  }
}

module.exports = { buildTrendAnalytics };
