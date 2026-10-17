// Trend tracking over time. Links the same trend across research runs (and quick scans), labels its momentum from its
// share of posts, and lays the history out as the cross-run Trend tracker workbook, the "what changed" list and the
// short digest Ask AI reads. Pure: no files, clocks or provider calls; `now` is passed in.
const { NAME_BANNED_WORDS, NAME_FILLER_STARTS, themeNameIssues } = require('./research-intel');

const TREND_TRACKER_ID = 'trend-tracker';
const PLATFORMS = ['x', 'linkedin', 'reddit'];
const PLATFORM_NAMES = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
const METRICS = ['likes', 'comments', 'shares', 'views', 'quotes', 'bookmarks', 'upvotes'];
const REPORT_DELIVERABLES = ['evidence-report', 'editorial-toolkit'];
// Momentum compares a trend's share of the posts a run kept, not raw counts, so runs of different sizes compare fairly.
// It is directional only: runs differ in sources and windows.
const MOMENTUM = Object.freeze({ risingRatio: 1.25, risingMinPp: 0.25, fadingRatio: 0.7, fadingMissedRuns: 2, streakRuns: 3 });
// Fuzzy linking: 0.55 × name overlap + 0.35 × keyword overlap + 0.10 for the same category.
const SIMILARITY = Object.freeze({ threshold: 0.55, name: 0.55, keywords: 0.35, category: 0.1 });
const MOMENTUM_ORDER = { rising: 0, new: 1, steady: 2, fading: 3 };
const MOMENTUM_LABELS = { new: 'New', rising: 'Rising', steady: 'Steady', fading: 'Fading' };
const MAX_COLUMNS = 60; // workbooks.js EXPORT_LIMITS.columns: a wider tab can't be exported
const SPARK_POINTS = 8;

const TRACKER_SHEETS = {
  timeline: { name: 'Trend timeline', columns: ['Trend', 'Momentum', 'Category', 'Zone', 'First Seen', 'Last Seen', 'Runs Seen', 'Runs Since First Seen', 'Latest Posts', 'Previous Posts', 'Latest Share %', 'Share Change (pp)', 'Posts Across Runs', 'Latest X Posts', 'Latest LinkedIn Posts', 'Latest Reddit Posts', 'Latest Prevalence', 'Platforms', 'Latest Priority Tier', 'Novelty', 'Last Decision', 'Quick Scans', 'Aliases', 'matching_keywords', 'Trend Report', 'Trend Report Link', 'Strategy Report Link'] },
  weekly: { name: 'Weekly snapshot', columns: ['Week', 'Week Start', 'Trend', 'Category', 'Runs', 'Posts', 'Share %', 'Prevalence', 'X Posts', 'LinkedIn Posts', 'Reddit Posts', 'Momentum', 'Priority Tier', 'New This Week'] },
  categories: { name: 'Category momentum', columns: ['Category', 'Momentum', 'Zone', 'Trends', 'New', 'Rising', 'Steady', 'Fading', 'Posts (latest week)', 'Posts (previous week)', 'Latest Share %', 'Share Change (pp)', 'Change %', 'Top Trends', 'Editorial Action'] },
  runs: { name: 'Run log', columns: ['Run', 'Date', 'Type', 'Window', 'Status', 'Posts Kept', 'X Kept', 'LinkedIn Kept', 'Reddit Kept', 'Trends Found', 'Approved', 'Reports'] },
};

const STOPWORDS = new Set(`a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could couldn did didn do does doesn doing don down during each even ever every few for from further get gets getting got had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself just like ll made make makes many may me more most much must my myself need needs no nor not now of off on once one only or other our ours ourselves out over own really re same say says see she should shouldn so some still such than that the their theirs them themselves then there these they thing things think this those through to too under until up us use used using ve very via want wants was wasn way we well were weren what when where which while who whom why will with won would wouldn yes yet you your yours yourself yourselves anyone anything else everyone someone something lot lots kind sort actually maybe http https www com amp rt im its dont cant thats youre theyre ive`.split(/\s+/));
// Words that say nothing about which trend a name is: research-intel's banned and filler words plus trend boilerplate.
const NOISE = new Set([...STOPWORDS, ...NAME_BANNED_WORDS, ...NAME_FILLER_STARTS.flatMap((start) => start.trim().split(/\s+/)), 'trend', 'trending', 'new', 'rise', 'rising', 'growing', 'shift', 'shifting']);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const count = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };
const round = (value, places = 2) => { const factor = 10 ** places; return Math.round(value * factor) / factor; };
const share = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const pct = (value) => (value === null || value === undefined ? null : round(value * 100, 2));
const signed = (value) => (value === null || value === undefined ? '' : `${value > 0 ? '+' : ''}${round(value, 2)}`);
const dayOf = (value) => { const text = String(value || ''); return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''; };
const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const clip = (value, length) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text; };
const toIso = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; };
const cell = (value) => value === undefined || value === null ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : typeof value === 'number' ? (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '') : typeof value === 'object' ? JSON.stringify(value) : String(value);
const platformList = (ids) => ids.map((id) => PLATFORM_NAMES[id] || id).join(', ');

// Lower-case words with accents, punctuation, short words and noise removed, crudely singular ("tools" → "tool").
function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
function normalizeText(text) { return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function words(text, min = 3) {
  return normalizeText(text).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length >= min && !NOISE.has(word)).map(singular).filter((word) => word.length >= min && !NOISE.has(word));
}
// Order-free key for "is this the same name": "The rise of AI Overviews" and "AI overview" share one key.
function trendNameKey(name) { const tokens = [...new Set(words(name))].sort(); return tokens.length ? tokens.join(' ') : String(name || '').trim().toLowerCase(); }

function categoryOf(theme = {}) { const mapped = theme.scoring?.taxonomy?.category; return String(mapped && mapped !== 'UNMAPPED' ? mapped : theme.taxonomyCategory || '').trim(); }
function zoneOf(theme = {}) { const zone = theme.scoring?.taxonomy?.zone; return zone && zone !== 'UNKNOWN' ? String(zone) : ''; }
const keywordsOf = (theme = {}) => (Array.isArray(theme.matchingKeywords) ? theme.matchingKeywords : Array.isArray(theme.keywords) ? theme.keywords : []).filter((entry) => typeof entry === 'string' && entry.trim());
function profileOf(theme = {}) { return { nameTokens: new Set(words(theme.name)), keywordTokens: new Set(keywordsOf(theme).flatMap((keyword) => words(keyword))), category: categoryOf(theme).toLowerCase() }; }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let shared = 0; for (const value of a) if (b.has(value)) shared++; return shared / (a.size + b.size - shared); }
function sharesToken(a, b) { for (const value of a) if (b.has(value)) return true; return false; }

// 0 (unrelated) … 1 (same name, keywords and category). Without keywords on both sides, name and category carry it.
function trendSimilarity(a, b) {
  const left = a?.nameTokens instanceof Set ? a : profileOf(a); const right = b?.nameTokens instanceof Set ? b : profileOf(b);
  const name = jaccard(left.nameTokens, right.nameTokens);
  const category = left.category && left.category === right.category ? 1 : 0;
  if (!left.keywordTokens.size || !right.keywordTokens.size) return round((SIMILARITY.name * name + SIMILARITY.category * category) / (SIMILARITY.name + SIMILARITY.category), 4);
  return round(SIMILARITY.name * name + SIMILARITY.keywords * jaccard(left.keywordTokens, right.keywordTokens) + SIMILARITY.category * category, 4);
}

// A run's themes: every discovered theme, with the approved copy (which may carry an edited name) winning.
function runThemes(run = {}) {
  const byId = new Map();
  for (const theme of [...(Array.isArray(run.discoveredThemes) ? run.discoveredThemes : []), ...(Array.isArray(run.themes) ? run.themes : [])]) if (theme?.id && theme.name) byId.set(theme.id, { ...(byId.get(theme.id) || {}), ...theme });
  return [...byId.values()];
}
// A run observed trends once discovery finished, even when it found none (that absence counts toward fading).
const observedRun = (run) => Array.isArray(run?.discoveredThemes) || runThemes(run).length > 0;
const originOf = (run) => (run?.origin === 'quick-scan' ? 'quick-scan' : 'research');
const runDate = (run) => dayOf(run?.window?.endDate) || dayOf(run?.createdAt) || dayOf(run?.updatedAt);

// ISO week ("2026-W42") and its Monday.
function isoWeek(day) {
  const date = new Date(`${dayOf(day)}T00:00:00Z`); if (!Number.isFinite(date.getTime())) return { key: '', start: '' };
  const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear(); const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((thursday - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { key: `${year}-W${String(week).padStart(2, '0')}`, start: monday.toISOString().slice(0, 10) };
}

// Per-run numbers the tracker needs, cached beside the run as theme-stats.json. Tagged counts follow the run workbook's
// theme totals rule (approved themes, every tag that wasn't rejected); discovery counts split each theme's cited posts.
function computeThemeStats({ run = {}, evidence = [], assignments = [] } = {}) {
  const items = new Map((Array.isArray(evidence) ? evidence : []).filter((row) => row?.id).map((row) => [row.id, row]));
  const blank = () => ({ x: 0, linkedin: 0, reddit: 0, total: 0 });
  const discovery = {};
  for (const theme of runThemes(run)) {
    const posts = blank(); const seen = new Set();
    for (const evidenceId of theme.evidenceIds || []) { const row = items.get(evidenceId); if (!row || seen.has(evidenceId)) continue; seen.add(evidenceId); if (PLATFORMS.includes(row.platform)) posts[row.platform]++; posts.total++; }
    if (posts.total) discovery[theme.id] = posts;
  }
  const tagged = {};
  const list = Array.isArray(assignments) ? assignments : [];
  if (list.length) {
    const rows = new Map((run.themes || []).filter((theme) => theme?.id).map((theme) => [theme.id, new Map()]));
    const review = new Map();
    for (const assignment of list) {
      if (!assignment || assignment.status === 'rejected' || !rows.has(assignment.themeId)) continue;
      const row = items.get(assignment.itemId); if (!row) continue;
      rows.get(assignment.themeId).set(row.id, row);
      if (assignment.status === 'needs-review') review.set(assignment.themeId, (review.get(assignment.themeId) || 0) + 1);
    }
    for (const [themeId, byItem] of rows) {
      const posts = blank(); const prevalence = blank(); const metrics = Object.fromEntries(METRICS.map((key) => [key, 0])); const authors = new Set();
      for (const row of byItem.values()) {
        const platform = PLATFORMS.includes(row.platform) ? row.platform : null; const value = typeof row.engagement?.value === 'number' && Number.isFinite(row.engagement.value) ? row.engagement.value : 0;
        if (platform) { posts[platform]++; prevalence[platform] += value; }
        posts.total++; prevalence.total += value;
        for (const key of METRICS) if (typeof row.metrics?.[key] === 'number' && Number.isFinite(row.metrics[key])) metrics[key] += row.metrics[key];
        if (row.author) authors.add(`${row.platform}:${String(row.author).toLowerCase()}`);
      }
      tagged[themeId] = { posts, needsReview: review.get(themeId) || 0, metrics, prevalence: Object.fromEntries(Object.entries(prevalence).map(([key, value]) => [key, round(value)])), authors: authors.size };
    }
  }
  const all = [...items.values()];
  return { version: 1, runId: run.id || '', retained: all.length, discoveryEligible: all.filter((row) => row.eligible?.discovery !== false).length, tagged, discovery };
}

// Union-find over (run, theme) appearances. Links in priority order: the same theme id, then a tracked match, alias or
// identical name, then fuzzy similarity (strongest pairs first). A link that would join two themes of one run is
// refused, since a run's themes are distinct by construction. The root is always the earliest appearance.
function linkAppearances(nodes, repository = []) {
  const parent = nodes.map((_, index) => index);
  const runs = nodes.map((node) => new Set([node.runId]));
  const find = (index) => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
  const union = (a, b) => {
    let left = find(a); let right = find(b); if (left === right) return;
    for (const runId of runs[right]) if (runs[left].has(runId)) return;
    if (left > right) [left, right] = [right, left];
    parent[right] = left; for (const runId of runs[right]) runs[left].add(runId); runs[right] = null;
  };
  const byId = new Map(); const byName = new Map();
  nodes.forEach((node, index) => { push(byId, node.theme.id, index); if (node.nameKey) push(byName, node.nameKey, index); });
  for (const list of byId.values()) for (const index of list.slice(1)) union(list[0], index);
  nodes.forEach((node, index) => {
    const existing = node.theme.match?.existingThemeId; if (existing && byId.has(existing)) union(byId.get(existing)[0], index);
    for (const alias of node.theme.aliases || []) for (const other of byName.get(trendNameKey(alias)) || []) union(other, index);
    for (const other of byName.get(node.nameKey) || []) union(other, index);
  });
  for (const theme of repository) {
    const head = theme?.id ? byId.get(theme.id)?.[0] : undefined; if (head === undefined) continue;
    for (const alias of [theme.name, ...(theme.aliases || [])]) for (const other of byName.get(trendNameKey(alias)) || []) union(head, other);
  }
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[i].runId === nodes[j].runId || !sharesToken(nodes[i].profile.nameTokens, nodes[j].profile.nameTokens) || find(i) === find(j)) continue;
    const score = trendSimilarity(nodes[i].profile, nodes[j].profile); if (score >= SIMILARITY.threshold) pairs.push([score, i, j]);
  }
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, i, j] of pairs) union(i, j);
  const groups = new Map(); nodes.forEach((_, index) => push(groups, find(index), index));
  return [...groups.values()];
}

function appearanceOf(node, stats, snapshots) {
  const { run, date, origin, theme } = node; const runStats = stats[run.id] || {};
  const tagged = runStats.tagged?.[theme.id]; const snapshot = snapshots.get(`${run.id}|${theme.id}`);
  const retained = count(run.counts?.retained) || count(runStats.retained);
  const verdict = run.decisions?.[theme.id];
  const decision = verdict === 'passed' ? 'passed' : verdict === 'approved' || (run.approvedAt && (run.themes || []).some((row) => row?.id === theme.id)) ? 'approved' : 'pending';
  let posts; let ratio; let cohortCount; let prevalence = null; let basis;
  // Tagged numbers come from theme-stats; a history snapshot alone (stats not counted yet) still gives the tagged share.
  if (tagged || share(snapshot?.share) !== null) {
    basis = 'tagged'; posts = tagged ? { x: count(tagged.posts?.x), linkedin: count(tagged.posts?.linkedin), reddit: count(tagged.posts?.reddit), total: count(tagged.posts?.total) } : { x: null, linkedin: null, reddit: null, total: count(snapshot.matchedCount) };
    cohortCount = count(snapshot?.cohortCount) || retained;
    ratio = share(snapshot?.share) ?? (cohortCount ? posts.total / cohortCount : null);
    prevalence = share(tagged?.prevalence?.total);
  } else {
    basis = 'discovery'; const split = runStats.discovery?.[theme.id];
    posts = split ? { x: count(split.x), linkedin: count(split.linkedin), reddit: count(split.reddit), total: count(split.total) } : { x: null, linkedin: null, reddit: null, total: count(theme.evidenceCount ?? theme.evidenceIds?.length) };
    cohortCount = count(run.counts?.discoveryEligible) || count(runStats.discoveryEligible) || retained;
    ratio = cohortCount ? posts.total / cohortCount : null;
  }
  const week = isoWeek(date);
  return { runId: run.id, runTitle: run.title || '', runDate: date, weekKey: week.key, weekStart: week.start, origin, runStatus: run.status || '', programId: run.programId || '', themeId: theme.id, name: theme.name, decision, basis, posts, cohortCount, share: ratio === null ? null : round(ratio, 6), prevalence,
    platforms: (theme.platforms || []).filter((platform) => PLATFORMS.includes(platform)), priorityTier: theme.scoring?.priorityTier || '', priorityScore: share(theme.scoring?.priorityScore), gapSignal: theme.scoring?.gapSignal || '', novelty: theme.novelty || '' };
}

// Share-based direction between two appearances of the same basis; null when they can't be compared.
function shareDirection(latest, previous) {
  if (!latest || !previous || latest.basis !== previous.basis || share(latest.share) === null || share(previous.share) === null) return null;
  const changePp = (latest.share - previous.share) * 100;
  if (latest.share >= MOMENTUM.risingRatio * previous.share && changePp >= MOMENTUM.risingMinPp) return 'rising';
  if (latest.share < MOMENTUM.fadingRatio * previous.share) return 'fading';
  return 'steady';
}

// appearances: one origin, oldest first. eligibleRuns: the run ids (oldest first) that could have seen the trend.
function momentumFor(appearances = [], { eligibleRuns = [] } = {}) {
  const list = appearances.filter(Boolean); const latest = list.at(-1);
  const empty = { compared: 'share', basis: '', latestShare: null, previousShare: null, changePp: null, relativeChange: null, missedRuns: 0, previousRunId: '', lastEligibleRunId: eligibleRuns.at(-1) || '', streak: false };
  if (!latest) return { momentum: 'steady', momentumBasis: empty };
  const position = eligibleRuns.indexOf(latest.runId);
  const missedRuns = position >= 0 ? eligibleRuns.length - 1 - position : 0;
  const previous = list.slice(0, -1).reverse().find((entry) => entry.basis === latest.basis && share(entry.share) !== null) || null;
  const latestShare = share(latest.share); const previousShare = previous ? previous.share : null;
  const comparable = latestShare !== null && previousShare !== null;
  const changePp = comparable ? round((latestShare - previousShare) * 100, 2) : null;
  const relativeChange = comparable && previousShare > 0 ? round(latestShare / previousShare - 1, 4) : null;
  const byRun = new Map(list.map((entry) => [entry.runId, entry]));
  const recent = eligibleRuns.length >= MOMENTUM.streakRuns ? eligibleRuns.slice(-MOMENTUM.streakRuns).map((runId) => byRun.get(runId)) : [];
  // A streak: found in each of the last three runs, its share never dropping and ending above where it started.
  const streak = recent.length === MOMENTUM.streakRuns && recent.every((entry) => entry && entry.basis === latest.basis && share(entry.share) !== null) && recent.every((entry, index) => !index || entry.share >= recent[index - 1].share) && recent.at(-1).share > recent[0].share;
  let momentum = 'steady';
  if (byRun.size === 1 && missedRuns === 0) momentum = 'new';
  else if (missedRuns >= MOMENTUM.fadingMissedRuns || (comparable && latestShare < MOMENTUM.fadingRatio * previousShare)) momentum = 'fading';
  else if (missedRuns === 0 && ((comparable && latestShare >= MOMENTUM.risingRatio * previousShare && changePp >= MOMENTUM.risingMinPp) || streak)) momentum = 'rising';
  return { momentum, momentumBasis: { ...empty, basis: latest.basis, latestShare, previousShare, changePp, relativeChange, missedRuns, previousRunId: previous?.runId || '', streak } };
}

function trendRecord(group, nodes, context) {
  const themes = group.map((index) => nodes[index].theme);
  const appearances = group.map((index) => appearanceOf(nodes[index], context.stats, context.snapshots));
  const research = appearances.filter((entry) => entry.origin === 'research'); const quick = appearances.filter((entry) => entry.origin === 'quick-scan');
  const origin = research.length ? 'research' : 'quick-scan'; const cohort = research.length ? research : quick;
  // Newest first, research runs ahead of quick scans: a quick scan's wording never renames a tracked trend.
  const newest = [...group].reverse().map((index) => nodes[index]).sort((a, b) => (a.origin === origin ? 0 : 1) - (b.origin === origin ? 0 : 1)).map((node) => node.theme);
  const name = newest.map((theme) => theme.name).find((value) => !themeNameIssues(value).length) || newest[0].name;
  const programIds = [...new Set(cohort.map((entry) => entry.programId).filter(Boolean))];
  const eligibleRuns = context.eligibleRuns(origin, programIds);
  const { momentum, momentumBasis } = momentumFor(cohort, { eligibleRuns });
  const firstIndex = eligibleRuns.indexOf(cohort[0].runId);
  const latest = cohort.at(-1);
  const keywordCounts = new Map(); newest.forEach((theme, rank) => keywordsOf(theme).forEach((keyword) => { const key = keyword.trim(); const entry = keywordCounts.get(key.toLowerCase()) || { key, count: 0, rank }; entry.count++; keywordCounts.set(key.toLowerCase(), entry); }));
  const nameKey = name.trim().toLowerCase(); const aliasSeen = new Set([nameKey]); const aliases = [];
  for (const value of [...newest.map((theme) => theme.name), ...newest.flatMap((theme) => theme.aliases || [])]) { const text = String(value || '').trim(); if (text && !aliasSeen.has(text.toLowerCase())) { aliasSeen.add(text.toLowerCase()); aliases.push(text); } }
  const platforms = PLATFORMS.filter((platform) => cohort.some((entry) => count(entry.posts[platform]) > 0 || entry.platforms.includes(platform)));
  const pairs = new Set(appearances.map((entry) => `${entry.runId}|${entry.themeId}`));
  const reports = context.reports.filter((report) => pairs.has(`${report.researchRunId}|${report.themeId}`)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(({ assetId, deliverableId, title, createdAt, url, researchRunId }) => ({ assetId, deliverableId, title: title || '', createdAt: createdAt || '', url: /^https:\/\//.test(url || '') ? url : '', runId: researchRunId }));
  const category = newest.map(categoryOf).find(Boolean) || 'Uncategorized';
  return {
    trendId: themes[0].id, name, aliases: aliases.slice(0, 20), themeIds: [...new Set(themes.map((theme) => theme.id))], category, zone: newest.map(zoneOf).find(Boolean) || '', novelty: newest.find((theme) => theme.novelty)?.novelty || '',
    keywords: [...keywordCounts.values()].sort((a, b) => b.count - a.count || a.rank - b.rank).slice(0, 10).map((entry) => entry.key), programIds, origin,
    firstSeen: cohort[0].runDate, lastSeen: latest.runDate, runsSeen: research.length, quickScansSeen: quick.length, runsSinceFirstSeen: firstIndex >= 0 ? eligibleRuns.length - firstIndex : cohort.length,
    appearances, totals: { posts: cohort.reduce((sum, entry) => sum + count(entry.posts.total), 0), prevalence: round(cohort.reduce((sum, entry) => sum + (entry.prevalence || 0), 0)) }, platforms,
    momentum, momentumBasis, latestPriorityTier: [...cohort].reverse().find((entry) => entry.priorityTier)?.priorityTier || '', latestDecision: latest.decision,
    editorialAction: newest.map((theme) => theme.scoring?.taxonomy?.editorialAction).find(Boolean) || '', summary: clip(newest.find((theme) => theme.description)?.description, 300), reports,
    latestPosts: count(latest.posts.total), latestSharePct: pct(latest.share), changePp: momentumBasis.changePp, spark: cohort.slice(-SPARK_POINTS).map((entry) => count(entry.posts.total)),
  };
}

const latestInWeek = (trend, weekKey) => trend.appearances.filter((entry) => entry.origin === 'research' && entry.weekKey === weekKey).at(-1) || null;

function categoryRows(trends, weeks, taxonomy) {
  const groups = new Map(); for (const trend of trends) if (trend.origin === 'research') push(groups, trend.category, trend);
  const actions = new Map((taxonomy?.categories || []).filter((entry) => entry?.category).map((entry) => [String(entry.category).toLowerCase(), entry]));
  return [...groups].map(([category, list]) => {
    const weekly = weeks.map((weekKey) => {
      let posts = 0; let total = 0; let seen = false;
      for (const trend of list) { const entry = latestInWeek(trend, weekKey); if (!entry) continue; seen = true; posts += count(entry.posts.total); total += share(entry.share) || 0; }
      return { weekKey, posts, share: seen ? round(total, 6) : null };
    });
    const latest = weekly.at(-1) || null; const previous = weekly.length > 1 ? weekly.at(-2) : null;
    const latestShare = latest?.share || 0; const previousShare = previous?.share || 0;
    let momentum = 'steady';
    if (weekly.length > 1) {
      if (latestShare > 0 && previousShare > 0) momentum = latestShare >= MOMENTUM.risingRatio * previousShare && (latestShare - previousShare) * 100 >= MOMENTUM.risingMinPp ? 'rising' : latestShare < MOMENTUM.fadingRatio * previousShare ? 'fading' : 'steady';
      else if (latestShare > 0) momentum = 'rising';
      else if (weekly.slice(0, -1).some((entry) => entry.share !== null)) momentum = 'fading';
    }
    const tally = (value) => list.filter((trend) => trend.momentum === value).length;
    const known = actions.get(category.toLowerCase());
    return { category, momentum, zone: known?.zone || list.map((trend) => trend.zone).find(Boolean) || '', trends: list.length, new: tally('new'), rising: tally('rising'), steady: tally('steady'), fading: tally('fading'),
      latestWeekPosts: latest?.posts || 0, previousWeekPosts: previous?.posts || 0, latestSharePct: pct(latestShare), changePp: previous ? round((latestShare - previousShare) * 100, 2) : null, changePct: previousShare > 0 ? round((latestShare / previousShare - 1) * 100, 1) : null,
      topTrends: [...list].sort((a, b) => (b.latestSharePct || 0) - (a.latestSharePct || 0)).slice(0, 3).map((trend) => trend.name), editorialAction: known?.editorialAction || list.map((trend) => trend.editorialAction).find(Boolean) || '', weekly };
  }).sort((a, b) => (b.latestSharePct || 0) - (a.latestSharePct || 0) || b.trends - a.trends || a.category.localeCompare(b.category));
}

// source = { runs, repository, history, reports, themeStats, taxonomy, version } (see content-workspace readTrendHistorySource).
function buildTrendHistory(source = {}, { now = new Date() } = {}) {
  const ordered = (Array.isArray(source.runs) ? source.runs : []).filter((run) => run?.id).map((run) => ({ run, date: runDate(run), origin: originOf(run) }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.run.createdAt || '').localeCompare(String(b.run.createdAt || '')) || a.run.id.localeCompare(b.run.id));
  const observed = ordered.filter((entry) => observedRun(entry.run));
  const nodes = [];
  for (const entry of observed) {
    const seen = new Set();
    for (const theme of runThemes(entry.run)) { if (seen.has(theme.id)) continue; seen.add(theme.id); nodes.push({ ...entry, runId: entry.run.id, theme, profile: profileOf(theme), nameKey: trendNameKey(theme.name) }); }
  }
  const snapshots = new Map((Array.isArray(source.history) ? source.history : []).filter((row) => row?.runId && row.themeId).map((row) => [`${row.runId}|${row.themeId}`, row]));
  const reports = (Array.isArray(source.reports) ? source.reports : []).filter((report) => report?.assetId && REPORT_DELIVERABLES.includes(report.deliverableId));
  const eligibleRuns = (origin, programIds) => { const list = observed.filter((entry) => entry.origin === origin); const mine = list.filter((entry) => programIds.includes(entry.run.programId || '')); return (mine.length ? mine : list).map((entry) => entry.run.id); };
  const context = { stats: isObject(source.themeStats) ? source.themeStats : {}, snapshots, reports, eligibleRuns };
  const trends = linkAppearances(nodes, Array.isArray(source.repository) ? source.repository : []).map((group) => trendRecord(group, nodes, context))
    .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'research' ? -1 : 1) || MOMENTUM_ORDER[a.momentum] - MOMENTUM_ORDER[b.momentum] || (b.latestSharePct ?? -1) - (a.latestSharePct ?? -1) || a.name.localeCompare(b.name));
  const runs = observed.map(({ run, date, origin }) => ({ id: run.id, title: run.title || '', date, createdAt: run.createdAt || '', updatedAt: run.updatedAt || run.createdAt || '', origin, programId: run.programId || '', status: run.status || '', stage: run.stage || '',
    retained: count(run.counts?.retained), platforms: Object.fromEntries(PLATFORMS.map((platform) => [platform, count(run.counts?.platforms?.[platform])])), themeCount: runThemes(run).length, approvedCount: Object.values(run.decisions || {}).filter((value) => value === 'approved').length }));
  const research = runs.filter((run) => run.origin === 'research');
  const weeks = [...new Set(research.map((run) => isoWeek(run.date).key).filter(Boolean))].sort();
  const dates = research.map((run) => run.date).filter(Boolean);
  return { asOf: toIso(now), version: String(source.version || ''), runCount: research.length, runsWithThemes: research.filter((run) => run.themeCount > 0).length, quickScanCount: runs.length - research.length,
    span: { from: dates[0] || '', to: dates.at(-1) || '' }, weeks, runs, trends, categories: categoryRows(trends, weeks, source.taxonomy) };
}

const reportOf = (trend) => trend.reports.find((report) => report.deliverableId === 'evidence-report') || trend.reports[0] || null;
// The renderer's trend shape (Home, Trends cards, the Trend board, chat trend cards).
function compactTrend(trend) {
  return { trendId: trend.trendId, themeIds: trend.themeIds, name: trend.name, category: trend.category, zone: trend.zone, momentum: trend.momentum, runsSeen: trend.runsSeen, quickScansSeen: trend.quickScansSeen, firstSeen: trend.firstSeen, lastSeen: trend.lastSeen,
    latestPosts: trend.latestPosts, latestSharePct: trend.latestSharePct, changePp: trend.changePp, platforms: trend.platforms, priorityTier: trend.latestPriorityTier, spark: trend.spark, reportAssetId: reportOf(trend)?.assetId || '', origin: trend.origin, summary: trend.summary };
}
// latestThemeId / latestRunId: the trend's newest research appearance, so What changed opens this run's card (themeIds
// keeps first-seen order, so its first id can be a card skipped in an older run).
const latestResearch = (trend) => trend.appearances.filter((entry) => entry.origin === 'research').at(-1) || null;
const changeEntry = (trend) => ({ trendId: trend.trendId, themeIds: trend.themeIds, latestThemeId: latestResearch(trend)?.themeId || '', latestRunId: latestResearch(trend)?.runId || '', name: trend.name, category: trend.category, momentum: trend.momentum, runsSeen: trend.runsSeen, lastSeen: trend.lastSeen, latestPosts: trend.latestPosts, latestSharePct: trend.latestSharePct, changePp: trend.changePp, missedRuns: trend.momentumBasis.missedRuns, reportAssetId: reportOf(trend)?.assetId || '' });

// "Since your last research run": what that run found new, what rose, and what faded (by share or by absence).
function trendChanges(history = {}) {
  const runs = (history.runs || []).filter((run) => run.origin === 'research' && run.themeCount > 0);
  const since = runs.at(-1) || null; const previous = runs.at(-2) || null;
  const research = (history.trends || []).filter((trend) => trend.origin === 'research');
  const latestRun = (trend) => trend.appearances.filter((entry) => entry.origin === 'research').at(-1)?.runId;
  const bySharePct = (a, b) => (b.latestSharePct ?? -1) - (a.latestSharePct ?? -1);
  const newTrends = since ? research.filter((trend) => trend.momentum === 'new' && latestRun(trend) === since.id).sort(bySharePct) : [];
  const rising = since ? research.filter((trend) => trend.momentum === 'rising' && latestRun(trend) === since.id).sort((a, b) => (b.changePp ?? 0) - (a.changePp ?? 0) || bySharePct(a, b)) : [];
  // Fading only while it is news: the trend's program ran in the latest run and it hasn't been gone for long.
  const fading = since ? research.filter((trend) => trend.momentum === 'fading' && trend.momentumBasis.lastEligibleRunId === since.id && trend.momentumBasis.missedRuns <= MOMENTUM.fadingMissedRuns).sort((a, b) => (a.changePp ?? -100) - (b.changePp ?? -100)) : [];
  const brief = (run) => (run ? { id: run.id, title: run.title, date: run.date } : null);
  return { sinceRun: brief(since), previousRun: brief(previous), runCount: runs.length, comparable: runs.length >= 2,
    counts: { new: newTrends.length, rising: rising.length, fading: fading.length, steady: research.filter((trend) => trend.momentum === 'steady').length },
    newTrends: newTrends.slice(0, 10).map(changeEntry), rising: rising.slice(0, 10).map(changeEntry), fading: fading.slice(0, 10).map(changeEntry) };
}

// The compact view Ask AI keeps in its live context: at most `maxChars` of JSON on every AI route.
function trendMemoryDigest(history = {}, { limit = 12, maxChars = 3000 } = {}) {
  const trends = history.trends || []; const research = trends.filter((trend) => trend.origin === 'research');
  const bySharePct = (a, b) => (b.latestSharePct ?? -1) - (a.latestSharePct ?? -1);
  const ranked = [...research.filter((trend) => ['rising', 'new'].includes(trend.momentum)).sort(bySharePct), ...research.filter((trend) => !['rising', 'new'].includes(trend.momentum)).sort(bySharePct), ...trends.filter((trend) => trend.origin !== 'research').sort(bySharePct)].slice(0, Math.max(0, limit));
  const changes = trendChanges(history);
  const digest = {
    asOf: history.asOf || '', runs: history.runCount || 0, quickScans: history.quickScanCount || 0, span: history.span?.from ? `${history.span.from} to ${history.span.to}` : '',
    trends: ranked.map((trend) => ({ name: clip(trend.name, 90), category: clip(trend.category, 60), momentum: trend.momentum, runsSeen: trend.runsSeen, firstSeen: trend.firstSeen, lastSeen: trend.lastSeen, latestPosts: trend.latestPosts, latestSharePct: trend.latestSharePct, changePp: trend.changePp, platforms: platformList(trend.platforms), priority: trend.latestPriorityTier, report: clip(reportOf(trend)?.title, 90), ...(trend.origin === 'quick-scan' ? { seenIn: 'quick scans only' } : {}) })),
    categories: (history.categories || []).slice(0, 8).map((entry) => ({ category: clip(entry.category, 60), momentum: entry.momentum, trends: entry.trends, changePct: entry.changePct })),
    changes: changes.sinceRun ? { since: changes.sinceRun.date, new: changes.newTrends.slice(0, 5).map((entry) => clip(entry.name, 70)), rising: changes.rising.slice(0, 5).map((entry) => clip(entry.name, 70)), fading: changes.fading.slice(0, 5).map((entry) => clip(entry.name, 70)) } : null,
    note: trends.length ? 'Directional: runs differ in sources and windows. Momentum compares each trend’s share of posts with its previous run; quick scans are short checks that never change it.' : 'No research run has found trends yet in this workspace.',
  };
  const fits = () => JSON.stringify(digest).length <= maxChars;
  while (!fits() && digest.categories.length > 3) digest.categories.pop();
  while (!fits() && digest.trends.length > 3) digest.trends.pop();
  if (!fits() && digest.changes) digest.changes = { since: digest.changes.since, new: digest.changes.new.slice(0, 2), rising: digest.changes.rising.slice(0, 2), fading: digest.changes.fading.slice(0, 2) };
  while (!fits() && digest.categories.length) digest.categories.pop();
  while (!fits() && digest.trends.length) digest.trends.pop();
  if (!fits()) digest.changes = null;
  if (!fits()) digest.note = '';
  return digest;
}

// One trend by id (any theme id it has used) or by name, for Ask AI's `trend` lookup.
function findTrend(history = {}, { trendId = '', name = '' } = {}) {
  const trends = history.trends || []; const id = String(trendId || '').trim();
  if (id) { const hit = trends.find((trend) => trend.trendId === id || trend.themeIds.includes(id)); if (hit) return hit; }
  const text = String(name || id || '').trim(); if (!text) return null;
  const key = trendNameKey(text);
  const exact = trends.find((trend) => trendNameKey(trend.name) === key || trend.aliases.some((alias) => trendNameKey(alias) === key)); if (exact) return exact;
  const lower = text.toLowerCase(); const contained = trends.find((trend) => trend.name.toLowerCase().includes(lower) || trend.aliases.some((alias) => alias.toLowerCase().includes(lower))); if (contained) return contained;
  const probe = new Set(words(text)); if (!probe.size) return null;
  let best = null; let bestScore = 0;
  for (const trend of trends) {
    const tokens = new Set([trend.name, ...trend.aliases].flatMap((value) => words(value)));
    const covered = [...probe].every((token) => tokens.has(token)); const score = covered ? 1 : jaccard(probe, tokens);
    if (score > bestScore) { best = trend; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

// Post search for Ask AI's `posts` lookup: posts = [{ …, haystack: normalizeText(text) }]. Ranked by how many query terms
// a post mentions, then engagement, then recency; one entry per link.
function queryTerms(query) { return [...new Set(words(query, 2))].slice(0, 8); }
function termPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term.length <= 3) return new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?![a-z0-9])`);
  if (term.length > 4 && term.endsWith('y')) return new RegExp(`(?:^|[^a-z0-9])${escaped.slice(0, -1)}(?:y|ie)`);
  return new RegExp(`(?:^|[^a-z0-9])${escaped}`);
}
function rankPosts(posts = [], query = '', { limit = 12 } = {}) {
  const terms = queryTerms(query); if (!terms.length) return [];
  const patterns = terms.map(termPattern); const phrase = normalizeText(query).replace(/\s+/g, ' ').trim();
  const scored = [];
  for (const post of posts) {
    const text = post?.haystack || ''; if (!text) continue;
    let matches = 0; for (const pattern of patterns) if (pattern.test(text)) matches++;
    if (!matches) continue;
    if (terms.length > 1 && phrase.includes(' ') && text.includes(phrase)) matches += 0.5;
    scored.push({ post, matches });
  }
  const needed = terms.length >= 3 ? 2 : 1; const strong = scored.filter((entry) => entry.matches >= needed);
  const pool = (strong.length ? strong : scored).sort((a, b) => b.matches - a.matches || (b.post.engagement || 0) - (a.post.engagement || 0) || String(b.post.publishedAt || '').localeCompare(String(a.post.publishedAt || '')));
  const seen = new Set(); const result = [];
  for (const { post } of pool) {
    const key = post.url || post.text; if (seen.has(key)) continue; seen.add(key);
    const { haystack: _haystack, ...rest } = post; result.push(rest);
    if (result.length >= Math.max(1, limit)) break;
  }
  return result;
}

// ── Trend tracker workbook ──────────────────────────────────────────────────────────────────────────────────────────
function uniqueLabels(labels) { const used = new Map(); return labels.map((label) => { const n = (used.get(label) || 0) + 1; used.set(label, n); return n === 1 ? label : `${label} (${n})`; }); }
function emptyTracker(key, columns, title, detail) { return { id: key, name: TRACKER_SHEETS[key].name, columns, rows: [], rowKeys: [], frozenColumns: 1, empty: { title, detail } }; }
const DECISION_LABELS = { approved: 'Approved', passed: 'Skipped' };
const decisionLabel = (entry) => (!entry ? '' : entry.origin === 'quick-scan' ? 'Quick scan' : DECISION_LABELS[entry.decision] || (entry.runStatus === 'awaiting-review' ? 'Needs your OK' : 'Not reviewed'));
const STATUS_LABELS = { succeeded: 'Finished', 'awaiting-review': 'Needs your OK', partial: 'Partly finished', failed: 'Stopped', cancelled: 'Cancelled', running: 'Running', queued: 'Queued' };

function timelineSheet(history) {
  const runs = history.runs.filter((run) => run.origin === 'research');
  const shown = runs.slice(-Math.max(0, MAX_COLUMNS - TRACKER_SHEETS.timeline.columns.length));
  const labels = uniqueLabels(shown.map((run) => `Posts ${run.date || 'undated'}`));
  const columns = [...TRACKER_SHEETS.timeline.columns, ...labels];
  if (!history.trends.length) return emptyTracker('timeline', columns, 'Trends appear after a research run finds them', 'Start a research run in Research programs. Each run adds a column here, and a trend found again in a later run stays on one row.');
  const rows = history.trends.map((trend) => {
    const cohort = trend.appearances.filter((entry) => entry.origin === trend.origin); const latest = cohort.at(-1);
    const previous = trend.momentumBasis.previousRunId ? cohort.find((entry) => entry.runId === trend.momentumBasis.previousRunId) : cohort.at(-2);
    const byRun = new Map(trend.appearances.filter((entry) => entry.origin === 'research').map((entry) => [entry.runId, entry]));
    const report = trend.reports.find((entry) => entry.deliverableId === 'evidence-report'); const toolkit = trend.reports.find((entry) => entry.deliverableId === 'editorial-toolkit');
    return [trend.name, MOMENTUM_LABELS[trend.momentum], trend.category, trend.zone, trend.firstSeen, trend.lastSeen, trend.runsSeen, trend.runsSinceFirstSeen, trend.latestPosts, previous ? count(previous.posts.total) : '', trend.latestSharePct, signed(trend.changePp), trend.totals.posts,
      latest?.posts.x, latest?.posts.linkedin, latest?.posts.reddit, latest?.prevalence, platformList(trend.platforms), trend.latestPriorityTier, trend.novelty, decisionLabel(latest), trend.quickScansSeen, trend.aliases.join('; '), JSON.stringify(trend.keywords),
      report?.title || '', report?.url || '', toolkit?.url || '', ...shown.map((run) => byRun.has(run.id) ? count(byRun.get(run.id).posts.total) : '')].map(cell);
  });
  return { id: 'timeline', name: TRACKER_SHEETS.timeline.name, columns, rows, rowKeys: history.trends.map((trend) => trend.trendId), frozenColumns: 1,
    note: `One row per trend, linked across runs by theme, alias and similar names. Momentum compares the trend’s share of posts with its previous run, so runs of different sizes compare fairly; it is directional, since runs differ in sources and windows. Each Posts column is one research run${runs.length > shown.length ? ` (the newest ${shown.length})` : ''}.` };
}

function weeklySheet(history) {
  const columns = TRACKER_SHEETS.weekly.columns;
  const research = history.trends.filter((trend) => trend.origin === 'research');
  const rows = []; const rowKeys = [];
  for (const weekKey of [...history.weeks].reverse()) {
    const entries = research.map((trend) => ({ trend, entry: latestInWeek(trend, weekKey) })).filter((row) => row.entry).sort((a, b) => (share(b.entry.share) ?? -1) - (share(a.entry.share) ?? -1));
    for (const { trend, entry } of entries) {
      const earlier = trend.appearances.filter((row) => row.origin === 'research' && row.weekKey && row.weekKey < weekKey);
      const prior = earlier.length ? latestInWeek(trend, earlier.at(-1).weekKey) : null;
      const runsThatWeek = trend.appearances.filter((row) => row.origin === 'research' && row.weekKey === weekKey).length;
      rows.push([weekKey, entry.weekStart, trend.name, trend.category, runsThatWeek, count(entry.posts.total), pct(entry.share), entry.prevalence, entry.posts.x, entry.posts.linkedin, entry.posts.reddit, prior ? MOMENTUM_LABELS[shareDirection(entry, prior) || 'steady'] : MOMENTUM_LABELS.new, entry.priorityTier, !prior].map(cell));
      rowKeys.push(`${weekKey}|${trend.trendId}`);
    }
  }
  if (!rows.length) return emptyTracker('weekly', columns, 'Weekly snapshots build up over time', 'Each week with a research run adds a row for every trend it found.');
  return { id: 'weekly', name: TRACKER_SHEETS.weekly.name, columns, rows, rowKeys, frozenColumns: 1, note: 'One row per trend per ISO week, from the latest research run that week. Momentum here compares with the trend’s previous week.' };
}

function categorySheet(history) {
  const weeks = history.weeks.slice(-Math.max(0, MAX_COLUMNS - TRACKER_SHEETS.categories.columns.length));
  const columns = [...TRACKER_SHEETS.categories.columns, ...weeks.map((weekKey) => `Posts ${weekKey}`)];
  if (!history.categories.length) return emptyTracker('categories', columns, 'Categories appear with your first trends', 'Trends are grouped by their taxonomy category. Load the Golden Thread taxonomy in Brand knowledge for sharper categories.');
  const rows = history.categories.map((entry) => { const byWeek = new Map(entry.weekly.map((week) => [week.weekKey, week])); return [entry.category, MOMENTUM_LABELS[entry.momentum], entry.zone, entry.trends, entry.new, entry.rising, entry.steady, entry.fading, entry.latestWeekPosts, entry.previousWeekPosts, entry.latestSharePct, signed(entry.changePp), entry.changePct === null ? '' : signed(entry.changePct), entry.topTrends.join('; '), entry.editorialAction, ...weeks.map((weekKey) => byWeek.get(weekKey)?.share === null ? '' : byWeek.get(weekKey)?.posts ?? '')].map(cell); });
  return { id: 'categories', name: TRACKER_SHEETS.categories.name, columns, rows, rowKeys: history.categories.map((entry) => entry.category), frozenColumns: 1, note: 'Share is the sum of the category’s trend shares in the latest research run of each week. Momentum compares the latest week with the week before.' };
}

function windowLabel(run) {
  const hours = count(run.quickScan?.lookbackHours || run.window?.hours || run.window?.lookbackHours);
  if (run.origin === 'quick-scan' && hours) return `Last ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const start = dayOf(run.window?.startDate) || dayOf(run.window?.startAt); const end = dayOf(run.window?.endDate) || dayOf(run.createdAt);
  if (start && end) return `${start} to ${end}`;
  return count(run.window?.lookbackDays) ? `Last ${run.window.lookbackDays} days` : '';
}

function runLogSheet(source) {
  const columns = TRACKER_SHEETS.runs.columns;
  const runs = (Array.isArray(source.runs) ? source.runs : []).filter((run) => run?.id).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!runs.length) return emptyTracker('runs', columns, 'No research runs yet', 'Start a research run in Research programs. Every run and quick scan is listed here.');
  const reports = new Map(); for (const report of Array.isArray(source.reports) ? source.reports : []) if (report?.researchRunId && report.deliverableId === 'evidence-report') reports.set(report.researchRunId, (reports.get(report.researchRunId) || 0) + 1);
  const rows = runs.map((run) => {
    const themes = runThemes(run); const quick = run.origin === 'quick-scan';
    const approved = Object.values(run.decisions || {}).filter((value) => value === 'approved').length || (run.approvedAt ? (run.themes || []).length : 0);
    return [run.title || 'Research run', runDate(run), quick ? 'Quick scan' : 'Research run', windowLabel(run), STATUS_LABELS[run.status] || run.status || '', run.counts ? count(run.counts.retained) : '', ...PLATFORMS.map((platform) => run.counts?.platforms ? count(run.counts.platforms[platform]) : ''), observedRun(run) ? themes.length : '', quick ? '' : approved, quick ? '' : reports.get(run.id) || 0].map(cell);
  });
  return { id: 'runs', name: TRACKER_SHEETS.runs.name, columns, rows, rowKeys: runs.map((run) => run.id), frozenColumns: 1, note: 'Every research run and quick scan in this workspace, newest first. Quick scans are short hour-level checks; they show as Quick Scans on the timeline and never change a research trend’s momentum.' };
}

function buildTrendTrackerWorkbook(source = {}, { now = new Date() } = {}) {
  const history = buildTrendHistory(source, { now });
  const research = history.trends.filter((trend) => trend.origin === 'research');
  const tally = (value) => research.filter((trend) => trend.momentum === value).length;
  const changes = trendChanges(history);
  const stamps = (Array.isArray(source.runs) ? source.runs : []).map((run) => String(run?.updatedAt || run?.createdAt || '')).filter(Boolean).sort();
  const created = (Array.isArray(source.runs) ? source.runs : []).map((run) => String(run?.createdAt || '')).filter(Boolean).sort();
  return { id: TREND_TRACKER_ID, name: 'Trend tracker', kind: 'tracker', createdAt: created[0] || '', updatedAt: stamps.at(-1) || history.asOf, status: '', stage: '',
    summary: { runCount: history.runCount, runsWithThemes: history.runsWithThemes, quickScanCount: history.quickScanCount, trendCount: history.trends.length, counts: { rising: tally('rising'), new: tally('new'), steady: tally('steady'), fading: tally('fading') }, sinceRun: changes.sinceRun, span: history.span },
    sheets: [timelineSheet(history), weeklySheet(history), categorySheet(history), runLogSheet(source)] };
}

module.exports = { TREND_TRACKER_ID, TRACKER_SHEETS, MOMENTUM, SIMILARITY, MOMENTUM_LABELS, trendNameKey, trendSimilarity, isoWeek, runThemes, computeThemeStats, momentumFor, buildTrendHistory, compactTrend, trendChanges, trendMemoryDigest, findTrend, normalizeText, queryTerms, rankPosts, buildTrendTrackerWorkbook };
