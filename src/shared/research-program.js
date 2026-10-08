const { createHash } = require('node:crypto');
const { validateResearchSchedule } = require('./research-schedule');
const intel = require('./research-intel');

// Pure research contracts. No provider calls, files, clocks, or workflow-global state.
// Defaults and formulas follow the n8n "Golden Thread" workflow node by node.
const MAX_EVIDENCE_ITEMS = 10000;
const PLATFORMS = ['x', 'linkedin', 'reddit'];
const PLATFORM_LABELS = { x: 'Twitter', linkedin: 'LinkedIn', reddit: 'Reddit' };
const PAIN_POINTS = ['Loss of Traffic/Visibility', 'Proving ROI/Attribution', 'Workflow/Resource Overload', 'Technical Complexity', 'Platform Frustration', 'None'];
const URGENCY_SIGNALS = ['Immediate Crisis', 'Strategic Planning', 'Passive Observation', 'None'];
const DEFAULT_THRESHOLDS = { discovery: { x: 40, linkedin: 25, reddit: 15 }, tagging: { x: 20, linkedin: 1, reddit: 1 } };
const RESEARCH_STAGES = ['discovery', 'synthesis', 'matching', 'tagging', 'reports'];
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
// n8n ran Opus 4.8 for discovery/synthesis/matching and Fable 5 for tagging and reports; these
// are the current models in the same tiers. Prices are list USD per million tokens (input, output).
const RESEARCH_MODELS = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', input: 10, output: 50 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5 },
];
const DEFAULT_RESEARCH_AI = Object.freeze({
  models: { discovery: 'claude-opus-5-5', synthesis: 'claude-opus-5-5', matching: 'claude-opus-5-5', tagging: 'claude-fable-5-1', reports: 'claude-fable-5-1' },
  effort: { discovery: 'medium', synthesis: 'high', matching: 'medium', tagging: 'low', reports: 'high' },
  concurrency: 3,
});
const DEFAULT_TAGGING_BATCH_SIZES = Object.freeze({ x: 50, linkedin: 40, reddit: 50 });
// Reddit departs from n8n (one run, 90s scroll): on a live run 90s reached only 3–4 days back in busy
// subreddits, so subreddits run in parallel groups of 6 with 300s of scrolling each.
const DEFAULT_COLLECTION_SETTINGS = Object.freeze({ xMaxItemsPerHandle: 50, xHandlesPerJob: 5, linkedinPostsPerProfile: 15, linkedinProfilesPerJob: 100, redditPostsPerSub: 300, redditScrollTimeoutSecs: 300, redditSubsPerJob: 6, laneConcurrency: 4 });
const DEFAULT_RESEARCH_PROGRAM = {
  targetPerPlatform: 3000, maxEvidenceItems: MAX_EVIDENCE_ITEMS, perAuthorCap: 10, lookbackDays: 7,
  discoveryBatchSize: 200, taggingBatchSize: 40, taggingBatchSizes: { ...DEFAULT_TAGGING_BATCH_SIZES }, maxThemes: 6,
  confidenceThreshold: 0.55, autoAcceptThreshold: 0.7, includeUndated: false, topicFiltersTargets: false, autoApproveThemes: false,
  budgets: { collectionUsd: 10, aiUsd: 25 }, thresholds: DEFAULT_THRESHOLDS, ai: DEFAULT_RESEARCH_AI, collection: { ...DEFAULT_COLLECTION_SETTINGS }, delivery: { publishToDrive: false },
};
const text = (v) => typeof v === 'string' ? v.trim() : '';
const digest = (v) => createHash('sha256').update(v).digest('hex').slice(0, 24);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
function object(v, field) { if (!isObject(v)) fail(field, `${field} must be an object.`); return v; }
function string(v, field, max = 1000, required = false) {
  if (v != null && typeof v !== 'string') fail(field, `${field} must be text.`);
  const value = text(v);
  if ((required && !value) || value.length > max) fail(field, `${field} must contain ${required ? '1' : '0'}–${max} characters.`);
  return value;
}
function number(v, field, min, max, fallback, integer = false) {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(field, `${field} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  return v;
}
function bool(v, field, fallback = false) { if (v === undefined) return fallback; if (typeof v !== 'boolean') fail(field, `${field} must be true or false.`); return v; }
function array(v, field, max = MAX_EVIDENCE_ITEMS) { if (!Array.isArray(v) || v.length > max) fail(field, `${field} must be a list of at most ${max} entries.`); return v; }
function strings(v, field, maxItems = 30, maxLength = 300) { return array(v === undefined ? [] : v, field, maxItems).map((x) => string(x, field, maxLength, true)); }
function date(v, field) {
  const value = string(v, field, 10);
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) fail(field, `Use a valid YYYY-MM-DD date for ${field}.`);
  return value;
}
function platform(v) { const p = text(v).toLowerCase(); return p === 'twitter' ? 'x' : p.startsWith('linkedin') ? 'linkedin' : p; }
function safeUrl(v) {
  try { const u = new URL(text(v)); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port || [...u.searchParams.keys()].some((key) => /^(token|access_token|api_key|apikey|signature|password)$/i.test(key))) return ''; for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid|trk)$/i.test(key)) u.searchParams.delete(key); u.hash = ''; return u.href; } catch { return ''; }
}
function boundedOptions(v = {}, field) {
  object(v, field);
  if (Object.keys(v).length > 40) fail(field, 'Too many source options.');
  return Object.fromEntries(Object.entries(v).map(([key, value]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(key) || /token|secret|password|apiKey|authorization/i.test(key)) fail(field, 'Source options must not contain credentials or unsafe keys.');
    if (typeof value === 'boolean' || value === null) return [key, value];
    if (typeof value === 'number') return [key, number(value, field, 0, 1000000, 0)];
    return [key, string(value, field, 2000)];
  }));
}
function normalizeTarget(value, p, field) {
  let target = string(value, field, 2000, true);
  if (/^https?:/i.test(target)) {
    const safe = safeUrl(target); if (!safe) fail(field, 'Use public platform URLs without credentials or ports.');
    const u = new URL(safe); const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (p === 'linkedin') {
      if (host !== 'linkedin.com' || !/^\/(in|company)\/[^/]+\/?$/.test(u.pathname)) fail(field, 'Use LinkedIn profile or company URLs.');
      return `https://www.linkedin.com${u.pathname.replace(/\/$/, '')}`;
    }
    if (p === 'reddit' && (host === 'reddit.com' || host === 'old.reddit.com') && /^\/r\/[^/]+\/?$/.test(u.pathname)) target = u.pathname.replace(/^\/r\//, '').replace(/\/$/, '');
    else if (p === 'x' && ['x.com', 'twitter.com'].includes(host) && /^\/[^/]+\/?$/.test(u.pathname)) target = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    else fail(field, 'Use the selected platform’s account or community URLs.');
  }
  if (p === 'linkedin') fail(field, 'LinkedIn targets must be full profile or company URLs.');
  target = target.replace(p === 'reddit' ? /^\/?r\//i : /^@/, '').replace(/\/$/, '').toLowerCase();
  if (!(p === 'reddit' ? /^[a-z0-9_]{2,21}$/ : /^[a-z0-9_]{1,15}$/).test(target)) fail(field, 'Enter a valid subreddit or account handle.');
  return target;
}
function modelId(v, field, fallback) {
  if (v === undefined || v === '') return fallback;
  const value = string(v, field, 80, true);
  if (!/^claude-[a-z0-9][a-z0-9.-]{1,70}$/.test(value)) fail(field, `${field} must be a Claude model ID such as claude-opus-5-5.`);
  return value;
}
function validateResearchAi(input) {
  const ai = input === undefined ? {} : object(input, 'ai');
  const models = ai.models === undefined ? {} : object(ai.models, 'ai.models');
  const effort = ai.effort === undefined ? {} : object(ai.effort, 'ai.effort');
  return {
    models: Object.fromEntries(RESEARCH_STAGES.map((stage) => [stage, modelId(models[stage], `ai.models.${stage}`, DEFAULT_RESEARCH_AI.models[stage])])),
    effort: Object.fromEntries(RESEARCH_STAGES.map((stage) => {
      const value = effort[stage] === undefined || effort[stage] === '' ? DEFAULT_RESEARCH_AI.effort[stage] : effort[stage];
      if (!EFFORT_LEVELS.includes(value)) fail(`ai.effort.${stage}`, `Choose an effort level: ${EFFORT_LEVELS.join(', ')}.`);
      return [stage, value];
    })),
    concurrency: number(ai.concurrency, 'ai.concurrency', 1, 6, DEFAULT_RESEARCH_AI.concurrency, true),
  };
}
function validateCollectionSettings(input) {
  const value = input === undefined ? {} : object(input, 'collection');
  const pick = (key, min, max) => number(value[key], `collection.${key}`, min, max, DEFAULT_COLLECTION_SETTINGS[key], true);
  return { xMaxItemsPerHandle: pick('xMaxItemsPerHandle', 10, 1000), xHandlesPerJob: pick('xHandlesPerJob', 1, 500), linkedinPostsPerProfile: pick('linkedinPostsPerProfile', 1, 100), linkedinProfilesPerJob: pick('linkedinProfilesPerJob', 1, 1000), redditPostsPerSub: pick('redditPostsPerSub', 10, 1000), redditScrollTimeoutSecs: pick('redditScrollTimeoutSecs', 10, 600), redditSubsPerJob: pick('redditSubsPerJob', 1, 50), laneConcurrency: pick('laneConcurrency', 1, 10) };
}
function validateResearchProgram(input = {}) {
  object(input, 'program');
  const name = string(input.name, 'name', 160, true);
  const query = string(input.query, 'query', 500);
  const sourceGroups = array(input.sourceGroups || [], 'sourceGroups', 20).map((group, index) => {
    object(group, `sourceGroups.${index}`);
    const sourceId = string(group.sourceId || group.platform, 'sourceId', 50, true);
    const p = platform(group.platform || sourceId);
    if (!PLATFORMS.includes(p) || platform(sourceId) !== p || !['x', 'twitter', 'reddit', 'linkedin', 'linkedin-profile', 'linkedin-search'].includes(sourceId)) fail('sourceGroups', 'Choose Reddit, X, or LinkedIn sources.');
    const values = typeof group.targets === 'string' ? group.targets.split(/[,\r\n]+/).filter((v) => v.trim()) : (group.targets || []);
    const targets = [...new Set(array(values, 'targets', 1000).map((v) => sourceId === 'linkedin-search' ? string(v, 'targets', 500, true) : normalizeTarget(v, p, 'targets')))];
    const enabled = bool(group.enabled, 'enabled', true);
    if (enabled && !targets.length && !(query && sourceId === 'linkedin-search')) fail('targets', 'Add targets to each enabled source group.');
    return { id: string(group.id, 'sourceGroup.id', 160) || `source-${digest(`${sourceId}:${index}:${targets.join(',')}`)}`, name: string(group.name, 'sourceGroup.name', 160) || `${p} sources`, sourceId: sourceId === 'linkedin' ? 'linkedin-profile' : sourceId === 'twitter' ? 'x' : sourceId, platform: p, targets, enabled, options: boundedOptions(group.options, 'sourceGroup.options') };
  });
  if (new Set(sourceGroups.map((g) => g.id)).size !== sourceGroups.length) fail('sourceGroups', 'Source group IDs must be unique.');
  if (sourceGroups.reduce((sum, group) => sum + group.targets.length, 0) > 2000) fail('targets', 'Use no more than 2,000 targets in a research program.');
  const window = object(input.window || {}, 'window');
  const startDate = date(window.startDate, 'window.startDate'); const endDate = date(window.endDate, 'window.endDate');
  if (startDate && endDate && startDate > endDate) fail('window.endDate', 'The end date must be on or after the start date.');
  const schedule = validateResearchSchedule(input.schedule);
  if (schedule.enabled && !sourceGroups.some(group => group.enabled)) fail('sourceGroups', 'Enable at least one source group before scheduling research.');
  const budgets = object(input.budgets || {}, 'budgets');
  if (input.thresholds !== undefined) object(input.thresholds, 'thresholds');
  const thresholds = {};
  for (const stage of ['discovery', 'tagging']) {
    const values = object(input.thresholds?.[stage] || {}, `thresholds.${stage}`);
    thresholds[stage] = Object.fromEntries(PLATFORMS.map((p) => [p, number(values[p], `thresholds.${stage}.${p}`, 0, 1000, DEFAULT_THRESHOLDS[stage][p])]));
  }
  const confidenceThreshold = number(input.confidenceThreshold, 'confidenceThreshold', 0.55, 1, 0.55);
  const autoAcceptThreshold = number(input.autoAcceptThreshold, 'autoAcceptThreshold', confidenceThreshold, 1, Math.max(0.7, confidenceThreshold));
  const legacyTaggingSize = number(input.taggingBatchSize, 'taggingBatchSize', 10, 200, DEFAULT_RESEARCH_PROGRAM.taggingBatchSize, true);
  const sizes = input.taggingBatchSizes === undefined ? {} : object(input.taggingBatchSizes, 'taggingBatchSizes');
  const delivery = input.delivery === undefined ? {} : object(input.delivery, 'delivery');
  return {
    id: string(input.id, 'id', 160) || `program-${digest(name + JSON.stringify(sourceGroups))}`, name, query, sourceGroups, window: { startDate, endDate }, schedule,
    targetPerPlatform: number(input.targetPerPlatform, 'targetPerPlatform', 1, MAX_EVIDENCE_ITEMS, 3000, true),
    maxEvidenceItems: number(input.maxEvidenceItems, 'maxEvidenceItems', 1, MAX_EVIDENCE_ITEMS, MAX_EVIDENCE_ITEMS, true),
    perAuthorCap: number(input.perAuthorCap, 'perAuthorCap', 1, 1000, 10, true),
    lookbackDays: number(input.lookbackDays, 'lookbackDays', 1, 365, DEFAULT_RESEARCH_PROGRAM.lookbackDays, true),
    discoveryBatchSize: number(input.discoveryBatchSize, 'discoveryBatchSize', 40, 200, 200, true),
    taggingBatchSize: legacyTaggingSize,
    taggingBatchSizes: Object.fromEntries(PLATFORMS.map((p) => [p, number(sizes[p], `taggingBatchSizes.${p}`, 10, 200, DEFAULT_TAGGING_BATCH_SIZES[p], true)])),
    maxThemes: number(input.maxThemes, 'maxThemes', 1, 6, 6, true),
    confidenceThreshold, autoAcceptThreshold, includeUndated: bool(input.includeUndated, 'includeUndated'),
    topicFiltersTargets: bool(input.topicFiltersTargets, 'topicFiltersTargets', false),
    autoApproveThemes: bool(input.autoApproveThemes, 'autoApproveThemes', false),
    budgets: { collectionUsd: number(budgets.collectionUsd, 'budgets.collectionUsd', 0.01, 1000, DEFAULT_RESEARCH_PROGRAM.budgets.collectionUsd), aiUsd: number(budgets.aiUsd, 'budgets.aiUsd', 0.01, 1000, DEFAULT_RESEARCH_PROGRAM.budgets.aiUsd) }, thresholds,
    ai: validateResearchAi(input.ai), collection: validateCollectionSettings(input.collection),
    delivery: { publishToDrive: bool(delivery.publishToDrive, 'delivery.publishToDrive', false) },
  };
}

// n8n Config: a run without a start date searches the last `lookbackDays` (default 7) up to now.
function resolveResearchWindow(program, at = new Date()) {
  const now = new Date(at); if (!Number.isFinite(now.getTime())) fail('at', 'A valid run time is required.');
  if (program.window?.startDate) return { startDate: program.window.startDate, endDate: program.window.endDate || '', resolvedFrom: 'program' };
  const start = new Date(now.getTime() - (program.lookbackDays || 7) * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: '', resolvedFrom: 'lookback', lookbackDays: program.lookbackDays || 7 };
}

function at(o, path) { return path.split('.').reduce((v, k) => isObject(v) && !['__proto__', 'constructor', 'prototype'].includes(k) ? v[k] : undefined, o); }
const METRIC_ALIASES = {
  likes: ['likes', 'likeCount', 'numLikes', 'favoriteCount', 'favorite_count', 'Total Reactions', 'engagement.likes'],
  comments: ['commentCount', 'replyCount', 'numComments', 'numberOfComments', 'num_comments', 'Comments', 'Number of Comments', 'engagement.comments', 'comments'],
  shares: ['shares', 'shareCount', 'numShares', 'retweetCount', 'repostCount', 'retweets', 'engagement.shares'],
  views: ['views', 'viewCount', 'impressions', 'engagement.views'],
  quotes: ['quotes', 'quoteCount', 'quote_count'], bookmarks: ['bookmarks', 'bookmarkCount', 'bookmark_count'],
  upvotes: ['upvotes', 'upVotes', 'Upvotes', 'score', 'ups'], upvoteRatio: ['upvoteRatio', 'upVoteRatio', 'upvote_ratio', 'Upvote Ratio'],
};
function researchMetrics(item = {}) {
  // Normalization historically fills absent metrics with 0. When raw data exists, it is
  // the authority for knownness; a missing provider value must not become an observed zero.
  const hasRaw = isObject(item.raw);
  const sources = hasRaw ? [item.raw, item.raw.metrics || {}, item.raw.engagement || {}] : [item.metrics || {}, item];
  const metrics = {}; const metricStatus = {};
  for (const [key, aliases] of Object.entries(METRIC_ALIASES)) {
    let found; let invalid = false;
    for (const source of sources) {
      for (const alias of [key, ...aliases]) {
        const raw = at(source, alias);
        if (raw === undefined || raw === null || raw === '') continue;
        if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !/^[-+]?\d+(?:\.\d+)?$/.test(raw.trim()))) { invalid = true; continue; }
        const value = Number(raw);
        if (!Number.isFinite(value) || (key === 'upvoteRatio' ? value < 0 || value > 1 : key !== 'upvotes' && value < 0)) { invalid = true; continue; }
        found = value; break;
      }
      if (found !== undefined) break;
    }
    metrics[key] = found ?? null; metricStatus[key] = found !== undefined ? 'known' : invalid ? 'invalid' : 'missing';
  }
  return { metrics, metricStatus };
}
// prevalence_score — the n8n sheet formulas: ROUND(Σ weight·LOG10(metric+1), 2).
function engagementScore(p, metrics = {}) {
  p = platform(p);
  const weights = p === 'x' ? { likes: 10, shares: 15, comments: 20, quotes: 25, bookmarks: 15, views: 2 } : p === 'linkedin' ? { likes: 10, comments: 25 } : p === 'reddit' ? { upvotes: 15, comments: 25 } : {};
  const keys = [...Object.keys(weights), ...(p === 'reddit' ? ['upvoteRatio'] : [])];
  const known = keys.filter((key) => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]));
  let value = Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Math.log10(Math.max(0, Number(metrics[key]) || 0) + 1), 0);
  if (p === 'reddit' && metrics.upvoteRatio >= 0.6) value += metrics.upvoteRatio * 5;
  return { value: known.length ? Math.round(value * 100) / 100 : null, knownMetrics: known, missingMetrics: keys.filter((key) => !known.includes(key)), complete: known.length === keys.length && keys.length > 0, basis: 'engagement-ranking-v1' };
}
// n8n "Prepare <Platform> Batch" engagement_score: the order posts are shown to the discovery model.
function batchEngagementScore(item) {
  const m = item.metrics || {}; const n = (key) => Number(m[key]) || 0;
  if (item.platform === 'x') return n('likes') + n('shares') * 2 + n('comments') * 1.5 + n('quotes') * 2 + n('bookmarks') * 1.5;
  if (item.platform === 'linkedin') return n('likes') + n('shares') * 3 + n('comments') * 2;
  return n('upvotes') + n('comments') * 2;
}
function evidenceIdentity(item, p, url, body) {
  const kind = text(item.type).toLowerCase() || 'post';
  const external = text(item.externalId) || text(item.raw?.commentId) || text(item.raw?.id);
  if (external) return `${p}:${kind}:${external}`;
  if (url && !['comment', 'reply', 'reaction'].includes(kind)) return `${p}:${kind}:${url}`;
  return `${p}:${kind}:${url}:${text(item.author).toLowerCase()}:${body}`;
}
// The handle n8n caps and fingerprints on: X userName, LinkedIn publicIdentifier, Reddit username.
function authorHandle(row, p) {
  const raw = row.raw || {};
  const handle = p === 'x' ? text(raw.author?.userName) : p === 'linkedin' ? text(raw.author?.publicIdentifier) || text(raw.authorPublicIdentifier) : text(raw.username);
  return handle || text(row.author);
}
function prepareResearchEvidence({ runId, program, items = [], rawItems } = {}) {
  runId = string(runId, 'runId', 160, true); program = validateResearchProgram(program);
  array(items, 'items', 100000);
  if (rawItems !== undefined && (!Array.isArray(rawItems) || rawItems.length !== items.length)) fail('rawItems', 'Raw rows must align one-to-one with normalized rows.');
  const dropped = { unsupportedPlatform: 0, emptyText: 0, nonSpeech: 0, duplicate: 0, outsideWindow: 0, undated: 0, authorCap: 0, platformCap: 0, totalCap: 0 };
  const seen = new Set(); const fingerprints = new Set(); const candidates = [];
  const start = program.window.startDate ? Date.parse(`${program.window.startDate}T00:00:00Z`) : -Infinity;
  const end = program.window.endDate ? Date.parse(`${program.window.endDate}T00:00:00Z`) + 86400000 : Infinity;
  for (let index = 0; index < items.length; index++) {
    const original = object(items[index], `items.${index}`); const row = rawItems ? { ...original, raw: rawItems[index] } : original;
    const p = platform(row.platform); if (!PLATFORMS.includes(p)) { dropped.unsupportedPlatform++; continue; }
    if (text(row.type).toLowerCase() === 'reaction') { dropped.nonSpeech++; continue; }
    const raw = row.raw || {};
    const title = text(raw.title || raw['Post Title']); const body = text(row.text || raw.post_text || raw.content || raw.body);
    const content = p === 'reddit' && title && !body.startsWith(title) ? `${title}${body ? `\n${body}` : ''}` : body;
    if (!content) { dropped.emptyText++; continue; }
    if (content.length > 60000) fail('items.text', 'An evidence item exceeds 60,000 characters; split it before analysis.');
    const url = safeUrl(row.url || raw.post_url || raw.linkedinUrl || raw.url);
    const identity = evidenceIdentity(row, p, url, content);
    const author = authorHandle(row, p);
    // n8n Dedupe + Cap: URL first, then the first 100 characters (whitespace removed) + author,
    // which also catches reposts that only differ in their ending.
    const fp = `${p}:${content.slice(0, 100).toLowerCase().replace(/\s+/g, '')}|${author.toLowerCase()}`;
    if (seen.has(identity) || (url && seen.has(`url:${url}`) && !['comment', 'reply'].includes(text(row.type).toLowerCase())) || fingerprints.has(fp)) { dropped.duplicate++; continue; }
    seen.add(identity); if (url && !['comment', 'reply'].includes(text(row.type).toLowerCase())) seen.add(`url:${url}`); fingerprints.add(fp);
    const publishedAt = text(row.publishedAt || raw.createdAt || raw.postedAt?.date || raw.Date || raw['Date Created']);
    const timestamp = publishedAt ? Date.parse(publishedAt) : NaN;
    if (!Number.isFinite(timestamp) && !program.includeUndated && (start !== -Infinity || end !== Infinity)) { dropped.undated++; continue; }
    if (Number.isFinite(timestamp) && (timestamp < start || timestamp >= end)) { dropped.outsideWindow++; continue; }
    const values = researchMetrics(row); const score = engagementScore(p, values.metrics);
    const authorName = p === 'linkedin' ? text(raw.author?.name) : p === 'x' ? text(raw.author?.name) : '';
    candidates.push({ id: `evidence-${digest(`${runId}:${identity}`)}`, runId, sourceItemId: text(row.id), sourceRunId: text(row.runId), sourceGroupId: text(row.sourceGroupId), platform: p, type: text(row.type) || 'post', externalId: text(row.externalId), author, authorName: authorName && authorName !== author ? authorName : '', text: content, title: p === 'reddit' ? title : '', community: p === 'reddit' ? text(raw.communityName || raw.parsedCommunityName || raw.subreddit).replace(/^r\//i, '') : '', url, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '', dateKnown: Number.isFinite(timestamp), parentId: text(row.parentId), threadId: text(row.threadId), ...values, engagement: score, eligible: { discovery: score.value !== null && score.value > program.thresholds.discovery[p], tagging: score.value !== null && score.value > program.thresholds.tagging[p] } });
  }
  candidates.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || a.id.localeCompare(b.id));
  const authors = new Map(); const platformCounts = {}; const kept = [];
  for (const item of candidates) {
    // Unknown authors are independent records, not a fabricated single person.
    const authorKey = `${item.platform}:${item.author ? item.author.toLowerCase() : item.id}`;
    if ((authors.get(authorKey) || 0) >= program.perAuthorCap) { dropped.authorCap++; continue; }
    if ((platformCounts[item.platform] || 0) >= program.targetPerPlatform) { dropped.platformCap++; continue; }
    if (kept.length >= program.maxEvidenceItems) { dropped.totalCap++; continue; }
    kept.push(item); authors.set(authorKey, (authors.get(authorKey) || 0) + 1); platformCounts[item.platform] = (platformCounts[item.platform] || 0) + 1;
  }
  return { runId, programId: program.id, items: kept, receipt: { runId, inputCount: items.length, retainedCount: kept.length, dropped, platformCounts, discoveryEligibleCount: kept.filter((i) => i.eligible.discovery).length, taggingEligibleCount: kept.filter((i) => i.eligible.tagging).length, unknownMetricCount: kept.filter((i) => !i.engagement.complete).length, undatedRetainedCount: kept.filter((i) => !i.dateKnown).length, window: { ...program.window }, scope: 'Collected sample; not a population prevalence estimate.' } };
}

// What each AI stage actually sees. Discovery mirrors n8n "Prepare <Platform> Batch"; tagging
// sends only the record ID and text, like the n8n "Chunk <Platform> Batches" nodes.
function discoveryPost(item, ref = item.id) {
  const m = item.metrics || {}; const n = (key) => Number(m[key]) || 0;
  const engagement = item.platform === 'x' ? { likes: n('likes'), retweets: n('shares'), replies: n('comments'), quotes: n('quotes'), views: n('views'), bookmarks: n('bookmarks') }
    : item.platform === 'linkedin' ? { reactions: n('likes'), comments: n('comments'), shares: n('shares') }
      : { upvotes: n('upvotes'), comments: n('comments'), upvote_ratio: Number(m.upvoteRatio) || 0 };
  return { id: ref, text: item.text, author: item.author, date: item.publishedAt, url: item.url, source: PLATFORM_LABELS[item.platform] || item.platform, ...(item.community ? { subreddit: item.community } : {}), engagement: { ...engagement, engagement_score: Math.round(batchEngagementScore(item) * 100) / 100, prevalence_score: item.engagement?.value ?? null } };
}
function taggingPost(item, ref = item.id) { return { record_id: ref, post_text: item.text }; }
// Models mis-copy long hex IDs (a live run altered 7 of 78 cited evidence IDs), so prompts show
// short references (p1…pN for a batch's posts, T1…Tn for themes) and validators map them back.
// Full IDs still resolve, so saved outputs from earlier runs validate unchanged.
const postRef = (index) => `p${index + 1}`;
const themeRef = (index) => `T${index + 1}`;
const candidateRef = (index) => `c${index + 1}`;
function refLookup(ids, ref) {
  const map = new Map();
  ids.forEach((id, index) => { map.set(id, id); map.set(ref(index).toLowerCase(), id); });
  return (value) => { const key = typeof value === 'string' ? value.trim() : ''; return map.get(key) ?? map.get(key.toLowerCase()) ?? null; };
}

function buildBatches({ runId, items, batchSize, batchSizes, stage, maxCharacters = 160000, byPlatform = true, format = (item) => item }) {
  runId = string(runId, 'runId', 160, true); array(items, 'items');
  number(batchSize, 'batchSize', 10, 200, 40, true); number(maxCharacters, 'maxCharacters', 60000, 1000000, 160000, true);
  if (items.some((item) => item.runId !== runId)) fail('runId', 'All batch evidence must belong to the requested run.');
  if (new Set(items.map((i) => i.id)).size !== items.length) fail('items', 'Evidence IDs must be unique.');
  const eligible = items.filter((item) => item.eligible?.[stage] !== false);
  const groups = byPlatform ? PLATFORMS.map((p) => ({ platform: p, items: eligible.filter((item) => item.platform === p) })).filter((group) => group.items.length) : [{ platform: 'mixed', items: eligible }];
  const chunks = [];
  for (const group of groups) {
    const size = Math.min(200, Math.max(10, batchSizes?.[group.platform] || batchSize));
    let current = []; let characters = 0;
    for (const item of group.items) {
      const length = JSON.stringify(format(item)).length;
      if (length > maxCharacters) fail('items', 'One item exceeds the batch context limit.');
      if (current.length && (current.length >= size || characters + length > maxCharacters)) { chunks.push({ platform: group.platform, items: current }); current = []; characters = 0; }
      current.push(item); characters += length;
    }
    if (current.length) chunks.push({ platform: group.platform, items: current });
  }
  const perPlatform = {};
  const batches = chunks.map((chunk, index) => {
    perPlatform[chunk.platform] = (perPlatform[chunk.platform] || 0) + 1;
    return { id: `batch-${digest(`${runId}:${stage}:${index}:${chunk.items.map((i) => i.id).join(',')}`)}`, runId, stage, index: index + 1, totalBatches: chunks.length, platform: chunk.platform, platformBatchNumber: perPlatform[chunk.platform], items: chunk.items, evidenceIds: chunk.items.map((i) => i.id) };
  });
  return { batches, receipt: { runId, stage, inputCount: items.length, eligibleCount: eligible.length, plannedCount: batches.reduce((sum, b) => sum + b.items.length, 0), batchCount: batches.length, excludedCount: items.length - eligible.length, perPlatform } };
}
function buildDiscoveryBatches(options = {}) { return buildBatches({ maxCharacters: 600000, format: discoveryPost, ...options, stage: 'discovery', batchSize: options.batchSize ?? 200 }); }
function buildAssignmentBatches(options = {}) { return buildBatches({ maxCharacters: 400000, format: taggingPost, ...options, stage: 'tagging', batchSize: options.batchSize ?? 40 }); }
const stringSchema = { type: 'string' };
const stringListSchema = { type: 'array', items: stringSchema };
function schema(properties) { return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }; }
const DISCOVERY_SCHEMA = schema({ candidates: { type: 'array', maxItems: 10, items: schema({ name: stringSchema, summary: stringSchema, painPoint: { type: 'string', enum: PAIN_POINTS }, semanticIntentSignals: stringListSchema, actionability: stringSchema, evidenceIds: stringListSchema }) } });
const THEMES_SCHEMA = schema({ themes: { type: 'array', maxItems: 6, items: schema({ name: stringSchema, description: stringSchema, candidateIds: stringListSchema, novelty: { type: 'string', enum: ['NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'] }, matchingKeywords: stringListSchema, matchingCriteria: stringSchema, negativeCriteria: stringSchema, taxonomyCategory: stringSchema, contentGap: { type: 'string', enum: intel.TAXONOMY_ZONES }, gapRationale: stringSchema, recentTrend: { type: 'string', enum: intel.RECENT_TRENDS }, crossPlatform: { type: 'boolean' }, totalEvidence: { type: 'integer' } }) } });
const MATCHING_SCHEMA = schema({ matches: { type: 'array', maxItems: 6, items: schema({ themeId: stringSchema, matchedExistingId: { type: ['string', 'null'] }, finalName: stringSchema, nameSource: { type: 'string', enum: ['new', 'existing', 'rewritten'] }, reason: stringSchema }) } });
// The reason comes first so it is written before the confidence, as the n8n tagging rules require.
const ASSIGNMENTS_SCHEMA = schema({ assignments: { type: 'array', items: schema({ itemId: stringSchema, reason: stringSchema, themeId: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, painPoint: { type: 'string', enum: PAIN_POINTS }, urgency: { type: 'string', enum: URGENCY_SIGNALS }, entities: schema({ tools: stringListSchema, people: stringListSchema, companies: stringListSchema }) }) } });
function enumValue(v, values, field) { if (!values.includes(v)) fail(field, `Invalid ${field}.`); return v; }
function ids(v, allowed, field, { allowEmpty = false } = {}) {
  const result = strings(v, field, MAX_EVIDENCE_ITEMS, 200);
  if ((!allowEmpty && !result.length) || new Set(result).size !== result.length || result.some((id) => !allowed.has(id))) fail(field, `${field} must contain unique IDs from the supplied evidence.`);
  return result;
}
function validateCandidates(output, { runId, batch, items = batch?.items || [] } = {}) {
  object(output, 'discovery'); runId = string(runId, 'runId', 160, true);
  if (!batch || batch.runId !== runId || items.some((i) => i.runId !== runId)) fail('runId', 'Candidate evidence must be scoped to this run and batch.');
  const allowed = new Set(batch.evidenceIds || batch.items.map((i) => i.id)); const itemMap = new Map(items.map((i) => [i.id, i]));
  const resolve = refLookup([...allowed], postRef);
  const names = new Set(); let droppedRefs = 0; let droppedCandidates = 0;
  const returned = array(output.candidates, 'candidates', 10);
  const candidates = returned.flatMap((candidate) => {
    object(candidate, 'candidate'); const name = string(candidate.name, 'candidate.name', 160, true);
    if (names.has(name.toLowerCase())) fail('candidate.name', 'Merge duplicate candidate names within a batch.'); names.add(name.toLowerCase());
    // A reference that is not in this batch is dropped rather than failing the batch; a candidate
    // left with no real evidence is dropped too. Nothing is attributed to a post it did not cite.
    const cited = strings(candidate.evidenceIds, 'candidate.evidenceIds', MAX_EVIDENCE_ITEMS, 200);
    const evidenceIds = [...new Set(cited.map(resolve).filter(Boolean))];
    droppedRefs += cited.filter((value) => !resolve(value)).length;
    if (!evidenceIds.length) { droppedCandidates++; return []; }
    return [{ id: `candidate-${digest(`${runId}:${batch.id}:${name.toLowerCase()}`)}`, runId, batchId: batch.id, name, summary: string(candidate.summary, 'candidate.summary', 4000, true), painPoint: enumValue(candidate.painPoint, PAIN_POINTS, 'painPoint'), semanticIntentSignals: strings(candidate.semanticIntentSignals, 'semanticIntentSignals', 15, 300), actionability: string(candidate.actionability, 'actionability', 2000), evidenceIds, evidenceCount: evidenceIds.length, platforms: [...new Set(evidenceIds.map((id) => itemMap.get(id)?.platform).filter(Boolean))] }];
  });
  if (returned.length && !candidates.length) fail('candidate.evidenceIds', 'Every candidate cited only ids that are not in this batch. Cite posts with the "id" values shown in this batch.');
  return { candidates, receipt: { runId, batchId: batch.id, inputCount: allowed.size, candidateCount: candidates.length, citedCount: new Set(candidates.flatMap((c) => c.evidenceIds)).size, droppedRefs, droppedCandidates } };
}
// n8n "Aggregate Batch Candidates": merge by lower-cased name, union the intent signals and
// evidence, keep every source candidate ID so themes still trace back to posts.
function mergeCandidates(candidates = []) {
  const merged = new Map();
  for (const candidate of array(candidates, 'candidates', 100000)) {
    const key = text(candidate.name).toLowerCase(); if (!key) continue;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...candidate, id: `candidate-merged-${digest(`${candidate.runId}:${key}`)}`, sourceCandidateIds: [candidate.id], batchCount: 1 }); continue; }
    existing.semanticIntentSignals = [...new Set([...existing.semanticIntentSignals, ...(candidate.semanticIntentSignals || [])])].slice(0, 40);
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...(candidate.evidenceIds || [])])];
    existing.evidenceCount = existing.evidenceIds.length;
    existing.platforms = [...new Set([...existing.platforms, ...(candidate.platforms || [])])];
    existing.sourceCandidateIds.push(candidate.id); existing.batchCount++;
  }
  return [...merged.values()].sort((a, b) => b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name));
}
function synthesisCandidate(candidate, ref = candidate.id) {
  return { id: ref, name: candidate.name, summary: candidate.summary, primary_pain_point: candidate.painPoint, semantic_intent_signals: candidate.semanticIntentSignals, evidence_count: candidate.evidenceCount, semrush_actionability: candidate.actionability, platforms: candidate.platforms.map((p) => PLATFORM_LABELS[p] || p) };
}
function validateThemes(output, { runId, candidates = [], previousThemes = [], maxThemes = 6, taxonomy = null } = {}) {
  object(output, 'synthesis'); runId = string(runId, 'runId', 160, true); number(maxThemes, 'maxThemes', 1, 6, 6, true);
  array(candidates, 'candidates', 100000); array(previousThemes, 'previousThemes', 10000);
  if (candidates.some((c) => c.runId !== runId)) fail('runId', 'All candidates must belong to this research run.');
  const candidateMap = new Map(candidates.map((c) => [c.id, c])); const previousMap = new Map(previousThemes.map((t) => [t.id, t])); const seen = new Set();
  const categories = new Set((taxonomy?.categories || []).map((entry) => entry.category.toLowerCase()));
  const resolve = refLookup(candidates.map((c) => c.id), candidateRef); let droppedRefs = 0;
  const returned = array(output.themes, 'themes', 12);
  const themes = returned.flatMap((theme) => {
    object(theme, 'theme'); const name = string(theme.name, 'theme.name', 160, true).replace(/[.!?;:,]+$/, '');
    // Unknown candidate references are dropped; a theme left with none has no evidence and is dropped.
    const cited = strings(theme.candidateIds, 'theme.candidateIds', MAX_EVIDENCE_ITEMS, 200);
    const candidateIds = [...new Set(cited.map(resolve).filter(Boolean))];
    droppedRefs += cited.filter((value) => !resolve(value)).length;
    if (!candidateIds.length) return [];
    const existingId = theme.existingThemeId == null ? '' : string(theme.existingThemeId, 'existingThemeId', 160, true);
    if (existingId && !previousMap.has(existingId)) fail('existingThemeId', 'A historical theme must reference a known stable theme ID.');
    const id = existingId || `theme-${digest(`${runId}:${name.toLowerCase()}`)}`;
    if (seen.has(id) || seen.has(`name:${name.toLowerCase()}`)) fail('themes', 'Themes must have unique IDs and names.'); seen.add(id); seen.add(`name:${name.toLowerCase()}`);
    const evidenceIds = [...new Set(candidateIds.flatMap((key) => candidateMap.get(key).evidenceIds))];
    const previous = previousMap.get(existingId);
    const taxonomyCategory = string(theme.taxonomyCategory, 'taxonomyCategory', 160);
    if (categories.size && taxonomyCategory && taxonomyCategory.toUpperCase() !== 'NONE' && !categories.has(taxonomyCategory.toLowerCase())) fail('taxonomyCategory', `Use only a taxonomy category from the supplied list (got “${taxonomyCategory}”).`);
    const platforms = [...new Set(candidateIds.flatMap((key) => candidateMap.get(key).platforms || []))];
    return {
      id, runId, name, description: string(theme.description, 'theme.description', 5000, true), candidateIds, evidenceIds, evidenceCount: evidenceIds.length, platforms,
      novelty: enumValue(theme.novelty, ['NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'], 'novelty'), matchingKeywords: strings(theme.matchingKeywords, 'matchingKeywords', 30, 160), matchingCriteria: string(theme.matchingCriteria, 'matchingCriteria', 3000, true), negativeCriteria: string(theme.negativeCriteria, 'negativeCriteria', 3000), taxonomyCategory,
      contentGap: theme.contentGap === undefined ? '' : enumValue(theme.contentGap, intel.TAXONOMY_ZONES, 'contentGap'), gapRationale: string(theme.gapRationale, 'gapRationale', 3000), recentTrend: theme.recentTrend === undefined ? '' : enumValue(theme.recentTrend, intel.RECENT_TRENDS, 'recentTrend'),
      crossPlatform: theme.crossPlatform === undefined ? platforms.length > 1 : bool(theme.crossPlatform, 'crossPlatform'), totalEvidence: theme.totalEvidence === undefined ? evidenceIds.length : number(theme.totalEvidence, 'totalEvidence', 0, 1000000, 0, true),
      aliases: [...new Set([...(previous?.aliases || []), ...(previous && previous.name !== name ? [previous.name] : [])])].slice(-50),
    };
  });
  if (returned.length && !themes.length) fail('theme.candidateIds', 'Every theme cited only candidate ids that were not supplied. Use the "id" values of the INPUT CANDIDATES.');
  // n8n "To Rows (6)": rank by name quality, cross-platform reach and evidence, then hard-cap.
  const ranked = intel.rankThemes(themes).slice(0, maxThemes);
  return { themes: ranked, receipt: { runId, candidateCount: candidates.length, themeCount: ranked.length, returnedCount: themes.length, droppedRefs, citedCount: new Set(ranked.flatMap((t) => t.evidenceIds)).size, maximumThemes: maxThemes, nameIssues: ranked.filter((t) => t.nameIssues.length).map((t) => ({ name: t.name, issues: t.nameIssues })) } };
}
// The theme matching agent's answer, checked: every new theme once, existing IDs only, one new
// theme per existing theme, and the NAME QUALITY OVERRIDE enforced deterministically.
function validateThemeMatches(output, { themes = [], existing = [] } = {}) {
  object(output, 'matching');
  const themeMap = new Map(themes.map((t) => [t.id, t])); const existingMap = new Map(existing.map((t) => [t.id, t]));
  const matches = new Map(); const claimed = new Set();
  for (const entry of array(output.matches, 'matches', 12)) {
    object(entry, 'match'); const themeId = string(entry.themeId, 'match.themeId', 160, true);
    if (!themeMap.has(themeId)) fail('match.themeId', 'Return each new theme ID exactly as supplied.');
    if (matches.has(themeId)) fail('match.themeId', 'Return each new theme at most once.');
    const matchedId = entry.matchedExistingId == null || entry.matchedExistingId === '' ? null : string(entry.matchedExistingId, 'matchedExistingId', 160, true);
    if (matchedId && !existingMap.has(matchedId)) fail('matchedExistingId', 'Match only to an existing theme ID from the supplied list, or null.');
    const usable = matchedId && !claimed.has(matchedId) ? matchedId : null; if (usable) claimed.add(usable);
    const theme = themeMap.get(themeId); const previous = usable ? existingMap.get(usable) : null;
    const nameSource = enumValue(entry.nameSource, ['new', 'existing', 'rewritten'], 'nameSource');
    const proposed = string(entry.finalName, 'finalName', 160, true).replace(/[.!?;:,]+$/, '');
    const finalName = previous ? intel.preferredThemeName({ proposed: nameSource === 'existing' ? previous.name : proposed, existing: previous.name, original: theme.name }) : intel.preferredThemeName({ proposed, original: theme.name });
    matches.set(themeId, { themeId, matchedExistingId: usable, existingName: previous?.name || '', finalName, nameSource: !previous ? (finalName === theme.name ? 'new' : 'rewritten') : finalName === previous.name ? 'existing' : finalName === theme.name ? 'new' : 'rewritten', reason: string(entry.reason, 'match.reason', 2000) });
  }
  for (const theme of themes) if (!matches.has(theme.id)) matches.set(theme.id, { themeId: theme.id, matchedExistingId: null, existingName: '', finalName: theme.name, nameSource: 'new', reason: 'Not returned by the matching step; treated as a new topic.' });
  return { matches: [...matches.values()], receipt: { themeCount: themes.length, existingCount: existing.length, matchedCount: [...matches.values()].filter((m) => m.matchedExistingId).length } };
}
function validateAssignments(output, { runId, batch, themes = [], confidenceThreshold = 0.55, autoAcceptThreshold = 0.7 } = {}) {
  object(output, 'classification'); runId = string(runId, 'runId', 160, true);
  number(confidenceThreshold, 'confidenceThreshold', 0.55, 1, 0.55); number(autoAcceptThreshold, 'autoAcceptThreshold', confidenceThreshold, 1, 0.7);
  if (!batch || batch.runId !== runId) fail('runId', 'Assignments must use the current run’s batch.');
  const allowed = new Set(batch.evidenceIds || batch.items.map((i) => i.id)); const seen = new Set();
  const resolveItem = refLookup([...allowed], postRef); const resolveTheme = refLookup(themes.map((t) => t.id), themeRef);
  // Like the n8n parser, one bad row never fails the batch: it is skipped, its post stays missing,
  // and the caller's focused retry tags it again. Only a response with no usable row is rejected.
  const returned = array(output.assignments, 'assignments', 200); const ignored = [];
  const assignments = returned.flatMap((assignment) => {
    try {
      object(assignment, 'assignment');
      const itemId = resolveItem(assignment.itemId);
      if (!itemId) fail('itemId', `itemId "${String(assignment.itemId ?? '').slice(0, 40)}" is not a record_id in this batch.`);
      if (seen.has(itemId)) fail('itemId', 'A post was returned more than once.');
      const theme = assignment.themeId == null || assignment.themeId === '' ? null : assignment.themeId;
      const suggestedThemeId = theme == null ? null : resolveTheme(theme);
      if (theme != null && !suggestedThemeId) fail('themeId', `themeId "${String(theme).slice(0, 40)}" is not one of the supplied Theme IDs.`);
      const confidence = number(assignment.confidence, 'confidence', 0, 1, undefined);
      if (confidence === undefined) fail('confidence', 'Confidence is required.');
      const accepted = !!suggestedThemeId && confidence >= confidenceThreshold;
      const entities = object(assignment.entities, 'entities');
      const row = { runId, batchId: batch.id, itemId, themeId: accepted ? suggestedThemeId : null, suggestedThemeId, confidence, status: accepted ? confidence >= autoAcceptThreshold ? 'accepted' : 'needs-review' : 'rejected', reason: string(assignment.reason, 'reason', 3000, true), painPoint: enumValue(assignment.painPoint, PAIN_POINTS, 'painPoint'), urgency: enumValue(assignment.urgency, URGENCY_SIGNALS, 'urgency'), entities: Object.fromEntries(['tools', 'people', 'companies'].map((key) => [key, strings(entities[key], `entities.${key}`, 30, 200)])) };
      seen.add(itemId); return [row];
    } catch (error) { ignored.push(error.message); return []; }
  });
  if (returned.length && !assignments.length) fail('assignments', `No usable assignments: ${ignored[0]} Use each post's record_id as itemId and a Theme ID shown above (or null).`);
  const missingIds = [...allowed].filter((id) => !seen.has(id));
  return { assignments, missingIds, receipt: { runId, batchId: batch.id, expectedCount: allowed.size, returnedCount: assignments.length, missingCount: missingIds.length, complete: !missingIds.length, ignoredCount: ignored.length, ignoredReasons: [...new Set(ignored)].slice(0, 5), rejectedCount: assignments.filter((a) => a.status === 'rejected').length, reviewCount: assignments.filter((a) => a.status === 'needs-review').length } };
}
// Posts the model never returned, even after a focused retry: recorded honestly as unclassified
// so one bad batch cannot stop the run (the n8n parser "never throws" for the same reason).
function unclassifiedAssignments({ runId, batch, itemIds = [] }) {
  return itemIds.map((itemId) => ({ runId, batchId: batch.id, itemId, themeId: null, suggestedThemeId: null, confidence: 0, status: 'rejected', unclassified: true, reason: 'Not returned by the classifier after a retry.', painPoint: 'None', urgency: 'None', entities: { tools: [], people: [], companies: [] } }));
}
function applyAssignments(existing = [], incoming = []) {
  const map = new Map(array(existing, 'existing').map((a) => [`${a.runId}:${a.itemId}`, a]));
  for (const assignment of array(incoming, 'incoming')) { if (!assignment.runId || !assignment.itemId) fail('assignments', 'Assignment identity is required.'); map.set(`${assignment.runId}:${assignment.itemId}`, assignment.status === 'rejected' ? { ...assignment, themeId: null } : assignment); }
  // A rejected replacement intentionally retains themeId:null; prior positive tags disappear.
  return [...map.values()];
}

function periodValue(period) {
  object(period, 'period'); const startDate = date(period.startDate, 'period.startDate'); const endDate = date(period.endDate, 'period.endDate');
  if (!startDate || !endDate || startDate > endDate) fail('period', 'Comparable periods need complete valid start and end dates.');
  const startMs = Date.parse(`${startDate}T00:00:00Z`); const endMs = Date.parse(`${endDate}T00:00:00Z`) + 86400000;
  return { startDate, endDate, startMs, endMs, days: (endMs - startMs) / 86400000 };
}
function calculateThemeHistory({ theme, runId, period, items = [], assignments = [], previousSnapshots = [], cohortKey = '', complete = true } = {}) {
  const currentPeriod = periodValue(period); runId = string(runId, 'runId', 160, true); const themeId = string(theme?.id, 'theme.id', 160, true);
  const currentItems = array(items, 'items').filter((i) => i.runId === runId); const itemIds = new Set(currentItems.map((i) => i.id));
  const matched = new Set(assignments.filter((a) => a.runId === runId && a.themeId === themeId && a.status !== 'rejected' && itemIds.has(a.itemId)).map((a) => a.itemId));
  const history = array(previousSnapshots, 'previousSnapshots', 10000).filter((s) => s.themeId === themeId && s.runId !== runId);
  const occurrences = new Set(history.filter((s) => s.matchedCount > 0).map((s) => s.runId)); if (matched.size) occurrences.add(runId);
  const classifiedIds = new Set(assignments.filter((a) => a.runId === runId && itemIds.has(a.itemId)).map((a) => a.itemId));
  const coverage = complete === true && currentItems.every((i) => (i.eligible?.tagging === false || classifiedIds.has(i.id)) && i.dateKnown !== false && i.publishedAt && Date.parse(i.publishedAt) >= currentPeriod.startMs && Date.parse(i.publishedAt) < currentPeriod.endMs);
  const snapshot = { runId, themeId, cohortKey: string(cohortKey, 'cohortKey', 500), period: { startDate: currentPeriod.startDate, endDate: currentPeriod.endDate }, complete: coverage, cohortCount: itemIds.size, matchedCount: matched.size, share: itemIds.size ? matched.size / itemIds.size : null };
  const comparable = history.filter((s) => {
    if (!snapshot.cohortKey || s.cohortKey !== snapshot.cohortKey || s.complete !== true || !Number.isInteger(s.cohortCount) || s.cohortCount <= 0 || !Number.isInteger(s.matchedCount) || s.matchedCount < 0 || s.matchedCount > s.cohortCount || !coverage || !itemIds.size) return false;
    try { const p = periodValue(s.period); return p.days === currentPeriod.days && p.endMs === currentPeriod.startMs; } catch { return false; }
  });
  const baseline = comparable.at(-1); const baselineShare = baseline ? baseline.matchedCount / baseline.cohortCount : null;
  const growth = baseline ? { comparable: true, baselineRunId: baseline.runId, currentShare: snapshot.share, previousShare: baselineShare, percentagePointChange: Math.round((snapshot.share - baselineShare) * 10000) / 100, relativePercentChange: baselineShare > 0 ? Math.round((snapshot.share / baselineShare - 1) * 10000) / 100 : null, reason: baselineShare === 0 ? 'No baseline matches; relative growth is undefined.' : '' } : { comparable: false, baselineRunId: null, currentShare: snapshot.share, previousShare: null, percentagePointChange: null, relativePercentChange: null, reason: 'Need complete adjacent equal-duration periods with the same source and sampling configuration.' };
  return { snapshot, recurrence: { observedRunCount: occurrences.size, label: occurrences.size >= 3 ? 'RECURRING' : occurrences.size === 2 ? 'REPEATED' : occurrences.size === 1 ? 'FIRST OBSERVED' : 'NOT OBSERVED' }, growth };
}
// n8n "Calculate Trend Velocity": gap signal from the taxonomy zone and recent editorial
// trend, velocity from how many runs detected the theme, then the FAST-TRACK…LOW tiers.
function calculateThemePriority({ theme = {}, detectionCount = 1, taxonomy = null } = {}) {
  const scoring = intel.scoreTheme({ theme, detectionCount, taxonomy });
  return { ...scoring, score: scoring.priorityScore, tier: scoring.priorityTier };
}

function aggregateEvidenceMetrics(items) {
  const platforms = {};
  for (const item of items) {
    const p = item.platform; platforms[p] ||= { itemCount: 0, authorCount: 0, authors: new Set(), metrics: {} };
    const out = platforms[p]; out.itemCount++; if (item.author) out.authors.add(item.author.toLowerCase());
    for (const key of Object.keys(METRIC_ALIASES)) {
      out.metrics[key] ||= { total: 0, knownCount: 0, missingCount: 0 };
      const value = item.metrics?.[key]; if (typeof value === 'number' && Number.isFinite(value)) { out.metrics[key].total += value; out.metrics[key].knownCount++; } else out.metrics[key].missingCount++;
    }
  }
  for (const out of Object.values(platforms)) { out.authorCount = out.authors.size; delete out.authors; for (const [key, values] of Object.entries(out.metrics)) { if (!values.knownCount) values.total = null; if (key === 'upvoteRatio') { values.average = values.knownCount ? values.total / values.knownCount : null; delete values.total; } } }
  return { itemCount: items.length, platforms };
}
function buildThemeEvidenceSnapshot({ runId, theme, items = [], assignments = [], maxItems = 500 } = {}) {
  runId = string(runId, 'runId', 160, true); maxItems = number(maxItems, 'maxItems', 1, 500, 500, true);
  const cohort = array(items, 'items').filter((i) => i.runId === runId); const themeId = string(theme?.id, 'theme.id', 160, true);
  const validAssignments = assignments.filter((a) => a.runId === runId && a.themeId === themeId && a.status !== 'rejected'); const assignmentMap = new Map(validAssignments.map((a) => [a.itemId, a]));
  const matched = cohort.filter((i) => assignmentMap.has(i.id));
  const queues = PLATFORMS.map((p) => matched.filter((i) => i.platform === p).sort((a, b) => (assignmentMap.get(b.id).confidence - assignmentMap.get(a.id).confidence) || ((b.engagement?.value || 0) - (a.engagement?.value || 0)) || a.id.localeCompare(b.id)));
  const selected = [];
  while (selected.length < maxItems && queues.some((q) => q.length)) for (const queue of queues) if (queue.length && selected.length < maxItems) selected.push(queue.shift());
  const painPoints = {}; const urgency = {}; for (const item of matched) { const a = assignmentMap.get(item.id); painPoints[a.painPoint] = (painPoints[a.painPoint] || 0) + 1; urgency[a.urgency] = (urgency[a.urgency] || 0) + 1; }
  return { runId, themeId, themeName: theme.name, evidenceIds: selected.map((i) => i.id), items: selected, assignments: selected.map((i) => assignmentMap.get(i.id)), metrics: { cohort: aggregateEvidenceMetrics(cohort), matched: aggregateEvidenceMetrics(matched), matchedShare: cohort.length ? matched.length / cohort.length : null, painPoints, urgency, needsReviewCount: matched.filter((i) => assignmentMap.get(i.id).status === 'needs-review').length }, coverage: { cohortCount: cohort.length, matchedCount: matched.length, selectedCount: selected.length, omittedCount: matched.length - selected.length, selection: 'Round-robin across platforms, then confidence and engagement within each platform.', scope: 'Metrics cover all retained cohort rows; report text is limited to selected source evidence.' } };
}
function validateExactQuotes(quotes, snapshot) {
  const itemMap = new Map((snapshot?.items || []).map((i) => [i.id, i]));
  return array(quotes, 'quotes', 100).map((quote) => {
    object(quote, 'quote'); const evidenceId = string(quote.evidenceId, 'quote.evidenceId', 200, true); const value = string(quote.quote, 'quote.quote', 4000, true); const item = itemMap.get(evidenceId);
    if (!item || !item.text.includes(value)) fail('quote', 'Quotes must be exact substrings of a selected evidence item.');
    return { evidenceId, quote: value, url: item.url, author: item.author, platform: item.platform };
  });
}

// Planning estimate for the AI stages, in list USD. Real spend is measured per call; this only
// sizes budgets before a run so a program is not started with an allowance it cannot finish on.
const EFFORT_OUTPUT_MULTIPLIER = { low: 1.3, medium: 1.8, high: 2.5, xhigh: 3.5, max: 5 };
function modelPrice(model) {
  const known = RESEARCH_MODELS.find((entry) => entry.id === model);
  if (known) return known;
  if (/fable|mythos/.test(model)) return { input: 10, output: 50 };
  if (/opus/.test(model)) return { input: 5, output: 25 };
  if (/sonnet-5/.test(model)) return { input: 2, output: 10 };
  if (/sonnet/.test(model)) return { input: 3, output: 15 };
  return { input: 1, output: 5 };
}
function callCost(model, effort, inputTokens, outputTokens) {
  const price = modelPrice(model); const multiplier = EFFORT_OUTPUT_MULTIPLIER[effort] || 2;
  return (inputTokens * price.input + outputTokens * multiplier * price.output) / 1e6;
}
// Measured on a live run (Oct 2026): these JSON prompts average ~2.4 characters per token (URLs,
// handles and escaped text tokenize poorly); the CLI's system prompt and schema add ~1,000.
function estimateTokens(characters) { return Math.ceil(characters / 2.4) + 1000; }
function estimateResearchCost(input, { evidenceCounts, themeCount } = {}) {
  const program = validateResearchProgram(input);
  const enabled = program.sourceGroups.filter((group) => group.enabled);
  const planned = {};
  for (const p of PLATFORMS) {
    const groups = enabled.filter((group) => group.platform === p); if (!groups.length) continue;
    const accounts = groups.filter((group) => group.sourceId !== 'linkedin-search').reduce((sum, group) => sum + group.targets.length, 0);
    // Reddit /new/ listings return up to redditPostsPerSub posts each; topic-filtered search is not bounded per community.
    const redditCeiling = program.topicFiltersTargets && program.query ? program.targetPerPlatform : accounts * program.collection.redditPostsPerSub;
    const estimate = p === 'reddit' ? Math.min(program.targetPerPlatform, redditCeiling) : Math.min(program.targetPerPlatform, accounts * program.perAuthorCap + (groups.some((group) => group.sourceId === 'linkedin-search') ? 200 : 0));
    planned[p] = Math.max(0, Math.min(program.targetPerPlatform, Number.isFinite(evidenceCounts?.[p]) ? evidenceCounts[p] : estimate));
  }
  const total = Object.values(planned).reduce((sum, count) => sum + count, 0);
  const { models, effort } = program.ai;
  const discoveryPosts = Math.round(total * 0.6); const taggingPosts = Math.round(total * 0.9);
  const discoveryBatches = PLATFORMS.reduce((sum, p) => sum + Math.ceil(Math.round((planned[p] || 0) * 0.6) / program.discoveryBatchSize), 0);
  const taggingBatches = PLATFORMS.reduce((sum, p) => sum + Math.ceil(Math.round((planned[p] || 0) * 0.9) / program.taggingBatchSizes[p]), 0);
  const themes = themeCount ?? program.maxThemes;
  // Per-post token sizes measured on the Oct 2026 live run (LinkedIn-heavy mix; X posts are shorter).
  const discovery = callCost(models.discovery, effort.discovery, discoveryPosts * 460 + discoveryBatches * 1500, discoveryBatches * 3500);
  const synthesis = discoveryBatches ? callCost(models.synthesis, effort.synthesis, Math.min(discoveryBatches * 10, 600) * 260 + 5000, 6000) : 0;
  const matching = discoveryBatches ? callCost(models.matching, effort.matching, 6000, 2500) : 0;
  const tagging = callCost(models.tagging, effort.tagging, taggingPosts * 330 + taggingBatches * 3000, taggingPosts * 110);
  const matchedPerTheme = Math.min(500, Math.ceil(taggingPosts * 0.6 / Math.max(1, themes)));
  const reports = themes * (callCost(models.reports, effort.reports, Math.min(240000, matchedPerTheme * 520 + 6000), 8000) + callCost(models.reports, effort.reports, 38000, 5000));
  const round = (value) => Math.round(value * 100) / 100;
  const stages = { discovery: round(discovery), synthesis: round(synthesis), matching: round(matching), tagging: round(tagging), reports: round(reports) };
  return { posts: { ...planned, total }, batches: { discovery: discoveryBatches, tagging: taggingBatches }, stages, totalUsd: round(Object.values(stages).reduce((sum, value) => sum + value, 0)), models, effort, basis: 'List prices per million tokens; actual CLI-reported cost is recorded per call.' };
}

module.exports = { MAX_EVIDENCE_ITEMS, PLATFORMS, PLATFORM_LABELS, PAIN_POINTS, URGENCY_SIGNALS, DEFAULT_THRESHOLDS, DEFAULT_RESEARCH_PROGRAM, DEFAULT_RESEARCH_AI, DEFAULT_TAGGING_BATCH_SIZES, DEFAULT_COLLECTION_SETTINGS, RESEARCH_STAGES, RESEARCH_MODELS, EFFORT_LEVELS, DISCOVERY_SCHEMA, THEMES_SCHEMA, MATCHING_SCHEMA, ASSIGNMENTS_SCHEMA, validateResearchProgram, resolveResearchWindow, researchMetrics, engagementScore, batchEngagementScore, prepareResearchEvidence, discoveryPost, taggingPost, postRef, themeRef, candidateRef, refLookup, buildDiscoveryBatches, buildAssignmentBatches, validateCandidates, mergeCandidates, synthesisCandidate, validateThemes, validateThemeMatches, validateAssignments, unclassifiedAssignments, applyAssignments, calculateThemeHistory, calculateThemePriority, aggregateEvidenceMetrics, buildThemeEvidenceSnapshot, validateExactQuotes, estimateResearchCost, callCost, estimateTokens, modelPrice };
