const { createHash } = require('node:crypto');
const { validateResearchSchedule } = require('./research-schedule');

// Pure research contracts. No provider calls, files, clocks, or workflow-global state.
const MAX_EVIDENCE_ITEMS = 10000;
const PLATFORMS = ['x', 'linkedin', 'reddit'];
const PAIN_POINTS = ['Loss of Traffic/Visibility', 'Proving ROI/Attribution', 'Workflow/Resource Overload', 'Technical Complexity', 'Platform Frustration', 'None'];
const URGENCY_SIGNALS = ['Immediate Crisis', 'Strategic Planning', 'Passive Observation', 'None'];
const DEFAULT_THRESHOLDS = { discovery: { x: 40, linkedin: 25, reddit: 15 }, tagging: { x: 20, linkedin: 1, reddit: 1 } };
const DEFAULT_RESEARCH_PROGRAM = {
  targetPerPlatform: 3000, maxEvidenceItems: MAX_EVIDENCE_ITEMS, perAuthorCap: 10,
  discoveryBatchSize: 200, taggingBatchSize: 40, maxThemes: 6,
  confidenceThreshold: 0.55, autoAcceptThreshold: 0.7, includeUndated: false,
  budgets: { collectionUsd: 5, aiUsd: 5 }, thresholds: DEFAULT_THRESHOLDS,
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
  return {
    id: string(input.id, 'id', 160) || `program-${digest(name + JSON.stringify(sourceGroups))}`, name, query, sourceGroups, window: { startDate, endDate }, schedule,
    targetPerPlatform: number(input.targetPerPlatform, 'targetPerPlatform', 1, MAX_EVIDENCE_ITEMS, 3000, true),
    maxEvidenceItems: number(input.maxEvidenceItems, 'maxEvidenceItems', 1, MAX_EVIDENCE_ITEMS, MAX_EVIDENCE_ITEMS, true),
    perAuthorCap: number(input.perAuthorCap, 'perAuthorCap', 1, 1000, 10, true),
    discoveryBatchSize: number(input.discoveryBatchSize, 'discoveryBatchSize', 40, 200, 200, true),
    taggingBatchSize: number(input.taggingBatchSize, 'taggingBatchSize', 40, 200, 40, true),
    maxThemes: number(input.maxThemes, 'maxThemes', 1, 6, 6, true),
    confidenceThreshold, autoAcceptThreshold, includeUndated: bool(input.includeUndated, 'includeUndated'),
    budgets: { collectionUsd: number(budgets.collectionUsd, 'budgets.collectionUsd', 0.01, 1000, 5), aiUsd: number(budgets.aiUsd, 'budgets.aiUsd', 0.01, 1000, 5) }, thresholds,
  };
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
function engagementScore(p, metrics = {}) {
  p = platform(p);
  const weights = p === 'x' ? { likes: 10, shares: 15, comments: 20, quotes: 25, bookmarks: 15, views: 2 } : p === 'linkedin' ? { likes: 10, comments: 25 } : p === 'reddit' ? { upvotes: 15, comments: 25 } : {};
  const keys = [...Object.keys(weights), ...(p === 'reddit' ? ['upvoteRatio'] : [])];
  const known = keys.filter((key) => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]));
  let value = Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Math.log10(Math.max(0, Number(metrics[key]) || 0) + 1), 0);
  if (p === 'reddit' && metrics.upvoteRatio >= 0.6) value += metrics.upvoteRatio * 5;
  return { value: known.length ? Math.round(value * 100) / 100 : null, knownMetrics: known, missingMetrics: keys.filter((key) => !known.includes(key)), complete: known.length === keys.length && keys.length > 0, basis: 'engagement-ranking-v1' };
}
function evidenceIdentity(item, p, url, body) {
  const kind = text(item.type).toLowerCase() || 'post';
  const external = text(item.externalId) || text(item.raw?.commentId) || text(item.raw?.id);
  if (external) return `${p}:${kind}:${external}`;
  if (url && !['comment', 'reply', 'reaction'].includes(kind)) return `${p}:${kind}:${url}`;
  return `${p}:${kind}:${url}:${text(item.author).toLowerCase()}:${body}`;
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
    const fp = `${p}:${text(row.type) || 'post'}:${text(row.author).toLowerCase()}:${content.normalize('NFC').replace(/\s+/g, ' ')}`;
    if (seen.has(identity) || fingerprints.has(fp)) { dropped.duplicate++; continue; }
    seen.add(identity); fingerprints.add(fp);
    const publishedAt = text(row.publishedAt || raw.createdAt || raw.postedAt?.date || raw.Date || raw['Date Created']);
    const timestamp = publishedAt ? Date.parse(publishedAt) : NaN;
    if (!Number.isFinite(timestamp) && !program.includeUndated && (start !== -Infinity || end !== Infinity)) { dropped.undated++; continue; }
    if (Number.isFinite(timestamp) && (timestamp < start || timestamp >= end)) { dropped.outsideWindow++; continue; }
    const values = researchMetrics(row); const score = engagementScore(p, values.metrics);
    candidates.push({ id: `evidence-${digest(`${runId}:${identity}`)}`, runId, sourceItemId: text(row.id), sourceRunId: text(row.runId), sourceGroupId: text(row.sourceGroupId), platform: p, type: text(row.type) || 'post', externalId: text(row.externalId), author: text(row.author), text: content, url, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '', dateKnown: Number.isFinite(timestamp), parentId: text(row.parentId), threadId: text(row.threadId), ...values, engagement: score, eligible: { discovery: score.value !== null && score.value > program.thresholds.discovery[p], tagging: score.value !== null && score.value > program.thresholds.tagging[p] } });
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
  return { runId, programId: program.id, items: kept, receipt: { runId, inputCount: items.length, retainedCount: kept.length, dropped, platformCounts, discoveryEligibleCount: kept.filter((i) => i.eligible.discovery).length, taggingEligibleCount: kept.filter((i) => i.eligible.tagging).length, unknownMetricCount: kept.filter((i) => !i.engagement.complete).length, undatedRetainedCount: kept.filter((i) => !i.dateKnown).length, scope: 'Collected sample; not a population prevalence estimate.' } };
}

function buildBatches({ runId, items, batchSize, stage, maxCharacters = 160000 }) {
  runId = string(runId, 'runId', 160, true); array(items, 'items');
  number(batchSize, 'batchSize', 40, 200, 40, true); number(maxCharacters, 'maxCharacters', 60000, 500000, 160000, true);
  if (items.some((item) => item.runId !== runId)) fail('runId', 'All batch evidence must belong to the requested run.');
  if (new Set(items.map((i) => i.id)).size !== items.length) fail('items', 'Evidence IDs must be unique.');
  const eligible = items.filter((item) => item.eligible?.[stage] !== false);
  const chunks = []; let current = []; let characters = 0;
  for (const item of eligible) {
    const size = JSON.stringify(item).length;
    if (size > maxCharacters) fail('items', 'One item exceeds the batch context limit.');
    if (current.length && (current.length >= batchSize || characters + size > maxCharacters)) { chunks.push(current); current = []; characters = 0; }
    current.push(item); characters += size;
  }
  if (current.length) chunks.push(current);
  const batches = chunks.map((chunk, index) => ({ id: `batch-${digest(`${runId}:${stage}:${index}:${chunk.map((i) => i.id).join(',')}`)}`, runId, stage, index: index + 1, totalBatches: chunks.length, items: chunk, evidenceIds: chunk.map((i) => i.id) }));
  return { batches, receipt: { runId, stage, inputCount: items.length, eligibleCount: eligible.length, plannedCount: batches.reduce((sum, b) => sum + b.items.length, 0), batchCount: batches.length, excludedCount: items.length - eligible.length } };
}
function buildDiscoveryBatches(options = {}) { return buildBatches({ ...options, stage: 'discovery', batchSize: options.batchSize ?? 200 }); }
function buildAssignmentBatches(options = {}) { return buildBatches({ ...options, stage: 'tagging', batchSize: options.batchSize ?? 40 }); }
const stringSchema = { type: 'string' };
const stringListSchema = { type: 'array', items: stringSchema };
function schema(properties) { return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }; }
const DISCOVERY_SCHEMA = schema({ candidates: { type: 'array', maxItems: 10, items: schema({ name: stringSchema, summary: stringSchema, painPoint: { type: 'string', enum: PAIN_POINTS }, semanticIntentSignals: stringListSchema, actionability: stringSchema, evidenceIds: stringListSchema }) } });
const THEMES_SCHEMA = schema({ themes: { type: 'array', maxItems: 6, items: schema({ name: stringSchema, description: stringSchema, existingThemeId: { type: ['string', 'null'] }, candidateIds: stringListSchema, novelty: { type: 'string', enum: ['NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'] }, matchingKeywords: stringListSchema, matchingCriteria: stringSchema, negativeCriteria: stringSchema, taxonomyCategory: stringSchema }) } });
const ASSIGNMENTS_SCHEMA = schema({ assignments: { type: 'array', items: schema({ itemId: stringSchema, themeId: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, reason: stringSchema, painPoint: { type: 'string', enum: PAIN_POINTS }, urgency: { type: 'string', enum: URGENCY_SIGNALS }, entities: schema({ tools: stringListSchema, people: stringListSchema, companies: stringListSchema }) }) } });
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
  const names = new Set();
  const candidates = array(output.candidates, 'candidates', 10).map((candidate) => {
    object(candidate, 'candidate'); const name = string(candidate.name, 'candidate.name', 160, true);
    if (names.has(name.toLowerCase())) fail('candidate.name', 'Merge duplicate candidate names within a batch.'); names.add(name.toLowerCase());
    const evidenceIds = ids(candidate.evidenceIds, allowed, 'candidate.evidenceIds');
    return { id: `candidate-${digest(`${runId}:${batch.id}:${name.toLowerCase()}`)}`, runId, batchId: batch.id, name, summary: string(candidate.summary, 'candidate.summary', 4000, true), painPoint: enumValue(candidate.painPoint, PAIN_POINTS, 'painPoint'), semanticIntentSignals: strings(candidate.semanticIntentSignals, 'semanticIntentSignals', 15, 300), actionability: string(candidate.actionability, 'actionability', 2000), evidenceIds, evidenceCount: evidenceIds.length, platforms: [...new Set(evidenceIds.map((id) => itemMap.get(id)?.platform).filter(Boolean))] };
  });
  return { candidates, receipt: { runId, batchId: batch.id, inputCount: allowed.size, candidateCount: candidates.length, citedCount: new Set(candidates.flatMap((c) => c.evidenceIds)).size } };
}
function validateThemes(output, { runId, candidates = [], previousThemes = [], maxThemes = 6 } = {}) {
  object(output, 'synthesis'); runId = string(runId, 'runId', 160, true); number(maxThemes, 'maxThemes', 1, 6, 6, true);
  array(candidates, 'candidates', 10000); array(previousThemes, 'previousThemes', 10000);
  if (candidates.some((c) => c.runId !== runId)) fail('runId', 'All candidates must belong to this research run.');
  const candidateMap = new Map(candidates.map((c) => [c.id, c])); const previousMap = new Map(previousThemes.map((t) => [t.id, t])); const seen = new Set();
  const themes = array(output.themes, 'themes', maxThemes).map((theme) => {
    object(theme, 'theme'); const name = string(theme.name, 'theme.name', 160, true);
    const candidateIds = ids(theme.candidateIds, new Set(candidateMap.keys()), 'theme.candidateIds');
    const existingId = theme.existingThemeId == null ? '' : string(theme.existingThemeId, 'existingThemeId', 160, true);
    if (existingId && !previousMap.has(existingId)) fail('existingThemeId', 'A historical theme must reference a known stable theme ID.');
    const id = existingId || `theme-${digest(`${runId}:${name.toLowerCase()}`)}`;
    if (seen.has(id) || seen.has(`name:${name.toLowerCase()}`)) fail('themes', 'Themes must have unique IDs and names.'); seen.add(id); seen.add(`name:${name.toLowerCase()}`);
    const evidenceIds = [...new Set(candidateIds.flatMap((key) => candidateMap.get(key).evidenceIds))];
    const previous = previousMap.get(existingId);
    return { id, runId, name, description: string(theme.description, 'theme.description', 5000, true), candidateIds, evidenceIds, evidenceCount: evidenceIds.length, platforms: [...new Set(candidateIds.flatMap((key) => candidateMap.get(key).platforms || []))], novelty: enumValue(theme.novelty, ['NEW TOPIC', 'NEW ANGLE', 'EVERGREEN'], 'novelty'), matchingKeywords: strings(theme.matchingKeywords, 'matchingKeywords', 30, 160), matchingCriteria: string(theme.matchingCriteria, 'matchingCriteria', 3000, true), negativeCriteria: string(theme.negativeCriteria, 'negativeCriteria', 3000), taxonomyCategory: string(theme.taxonomyCategory, 'taxonomyCategory', 160), aliases: [...new Set([...(previous?.aliases || []), ...(previous && previous.name !== name ? [previous.name] : [])])].slice(-50) };
  });
  return { themes, receipt: { runId, candidateCount: candidates.length, themeCount: themes.length, citedCount: new Set(themes.flatMap((t) => t.evidenceIds)).size, maximumThemes: maxThemes } };
}
function validateAssignments(output, { runId, batch, themes = [], confidenceThreshold = 0.55, autoAcceptThreshold = 0.7 } = {}) {
  object(output, 'classification'); runId = string(runId, 'runId', 160, true);
  number(confidenceThreshold, 'confidenceThreshold', 0.55, 1, 0.55); number(autoAcceptThreshold, 'autoAcceptThreshold', confidenceThreshold, 1, 0.7);
  if (!batch || batch.runId !== runId) fail('runId', 'Assignments must use the current run’s batch.');
  const allowed = new Set(batch.evidenceIds || batch.items.map((i) => i.id)); const themeIds = new Set(themes.map((t) => t.id)); const seen = new Set();
  const assignments = array(output.assignments, 'assignments', 200).map((assignment) => {
    object(assignment, 'assignment'); const itemId = string(assignment.itemId, 'itemId', 200, true);
    if (!allowed.has(itemId) || seen.has(itemId)) fail('itemId', 'Return each supplied evidence ID at most once.'); seen.add(itemId);
    const suggestedThemeId = assignment.themeId == null ? null : string(assignment.themeId, 'themeId', 160, true);
    if (suggestedThemeId && !themeIds.has(suggestedThemeId)) fail('themeId', 'Assignments must reference a supplied theme ID.');
    const confidence = number(assignment.confidence, 'confidence', 0, 1, undefined);
    if (confidence === undefined) fail('confidence', 'Confidence is required.');
    const accepted = !!suggestedThemeId && confidence >= confidenceThreshold;
    const entities = object(assignment.entities, 'entities');
    return { runId, batchId: batch.id, itemId, themeId: accepted ? suggestedThemeId : null, suggestedThemeId, confidence, status: accepted ? confidence >= autoAcceptThreshold ? 'accepted' : 'needs-review' : 'rejected', reason: string(assignment.reason, 'reason', 3000, true), painPoint: enumValue(assignment.painPoint, PAIN_POINTS, 'painPoint'), urgency: enumValue(assignment.urgency, URGENCY_SIGNALS, 'urgency'), entities: Object.fromEntries(['tools', 'people', 'companies'].map((key) => [key, strings(entities[key], `entities.${key}`, 30, 200)])) };
  });
  const missingIds = [...allowed].filter((id) => !seen.has(id));
  return { assignments, missingIds, receipt: { runId, batchId: batch.id, expectedCount: allowed.size, returnedCount: assignments.length, missingCount: missingIds.length, complete: !missingIds.length, rejectedCount: assignments.filter((a) => a.status === 'rejected').length, reviewCount: assignments.filter((a) => a.status === 'needs-review').length } };
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
function calculateThemePriority({ history, novelty = 'EVERGREEN', knowledge = {} } = {}) {
  const sufficient = knowledge.sufficient === true && ['OPEN', 'MODERATE', 'SATURATED'].includes(knowledge.zone) && ['ACTIVE', 'SPORADIC', 'DORMANT'].includes(knowledge.recentTrend);
  if (!sufficient) return { score: null, tier: 'NEEDS CONTEXT', knowledgeSufficient: false, components: {}, rationale: 'Supply current taxonomy and editorial coverage before ranking a content gap.' };
  const gapSignal = knowledge.zone === 'OPEN' ? 'HIGH_OPPORTUNITY' : knowledge.zone === 'MODERATE' ? knowledge.recentTrend === 'DORMANT' ? 'HIGH_OPPORTUNITY' : 'CHECK_RECENCY' : knowledge.recentTrend === 'DORMANT' ? 'REFRESH_OPPORTUNITY' : 'LOW_OPPORTUNITY';
  const gap = { HIGH_OPPORTUNITY: 4, REFRESH_OPPORTUNITY: 3, CHECK_RECENCY: 2, LOW_OPPORTUNITY: 1 }[gapSignal] * 2;
  const recurrence = Math.min(3, history?.recurrence?.observedRunCount || 0) * 1.5;
  const noveltyScore = { 'NEW TOPIC': 3, 'NEW ANGLE': 2, EVERGREEN: 1 }[novelty] || 1;
  const recency = { DORMANT: 1, SPORADIC: 0.5, ACTIVE: 0 }[knowledge.recentTrend]; const phrasePenalty = knowledge.phraseOverlap === true && gapSignal === 'LOW_OPPORTUNITY' ? -2 : 0;
  const score = gap + recurrence + noveltyScore + recency + phrasePenalty;
  return { score, tier: score >= 14 ? 'FAST-TRACK' : score >= 10 ? 'STRONG' : score >= 7 ? 'MONITOR' : 'LOW', gapSignal, knowledgeSufficient: true, components: { gap, recurrence, novelty: noveltyScore, recency, phrasePenalty }, rationale: 'Editorial opportunity heuristic using observed recurrence, not a predicted performance or velocity score.' };
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
module.exports = { MAX_EVIDENCE_ITEMS, PLATFORMS, PAIN_POINTS, URGENCY_SIGNALS, DEFAULT_THRESHOLDS, DEFAULT_RESEARCH_PROGRAM, DISCOVERY_SCHEMA, THEMES_SCHEMA, ASSIGNMENTS_SCHEMA, validateResearchProgram, researchMetrics, engagementScore, prepareResearchEvidence, buildDiscoveryBatches, buildAssignmentBatches, validateCandidates, validateThemes, validateAssignments, applyAssignments, calculateThemeHistory, calculateThemePriority, aggregateEvidenceMetrics, buildThemeEvidenceSnapshot, validateExactQuotes };
