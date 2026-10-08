// Golden Thread editorial intelligence: taxonomy lookup, theme name quality and
// trend velocity / priority scoring. Ports the n8n nodes "Store Taxonomy in Static
// Data", "To Rows (6)" and "Calculate Trend Velocity" exactly. Pure: no files or clocks.

const TAXONOMY_ZONES = ['OPEN', 'MODERATE', 'SATURATED'];
const RECENT_TRENDS = ['ACTIVE', 'SPORADIC', 'DORMANT'];
const VELOCITY_TIERS = ['NEW', 'EMERGING', 'ACCELERATING'];
const PRIORITY_TIERS = ['FAST-TRACK', 'STRONG', 'MONITOR', 'LOW'];
const GAP_SIGNALS = ['NEW_TERRITORY', 'HIGH_OPPORTUNITY', 'REFRESH_OPPORTUNITY', 'CHECK_RECENCY', 'LOW_OPPORTUNITY'];
const NAME_BANNED_WORDS = ['transformation', 'revolution', 'paradigm', 'landscape', 'evolution', 'ecosystem'];
const NAME_FILLER_STARTS = ['the ', 'how ', 'impact of ', 'changes in ', 'rise of ', 'evolution of'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MAX_CATEGORIES = 200;

const clean = (value) => (value === undefined || value === null ? '' : String(value)).trim();
const list = (value) => clean(value).toLowerCase().split(',').map((entry) => entry.trim()).filter(Boolean);
const integer = (value) => { const number = parseInt(String(value ?? '').replace(/[,\s]/g, ''), 10); return Number.isFinite(number) ? number : 0; };
const headerKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

// "SEP 25", "Sep '25", "September 2025", "2025-09" → sortable month index; anything else → null.
function monthIndex(header) {
  const text = clean(header).toUpperCase();
  let match = text.match(/^(\d{4})[-/ ](\d{1,2})$/);
  if (match) return Number(match[1]) * 12 + Number(match[2]) - 1;
  match = text.match(/^([A-Z]{3})[A-Z]*\.?\s*'?(\d{2}|\d{4})$/);
  if (!match || !MONTHS.includes(match[1])) return null;
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return year * 12 + MONTHS.indexOf(match[1]);
}

const COLUMN_ALIASES = {
  category: ['category'], articleCount: ['article count', 'articles'], share: ['% share', 'share'], velocity: ['velocity'],
  last6Mo: ['last 6mo', 'last 6 mo', 'last 6 months'], rate6Mo: ['6mo rate', '6 mo rate'], saturation: ['saturation'], zone: ['zone'],
  topKeywords: ['top keywords', 'keywords'], topPhrases: ['top phrases', 'phrases'], timeline: ['timeline'],
  gapNotes: ['gap analysis notes', 'gap notes'], editorialAction: ['editorial action'],
};

// Rows come from an imported workbook tab (first row = header) or CSV. Monthly counts use
// month-named headers; the n8n sheet's trailing unnamed numeric columns are read the same way
// (oldest → newest), because "Calculate Trend Velocity" sums the last three of them.
function parseTaxonomyRows(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('The taxonomy needs a header row and at least one category.');
  const header = rows[0].map(clean);
  const keys = header.map(headerKey);
  const column = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = keys.findIndex((key) => aliases.includes(key));
    if (index >= 0) column[field] = index;
  }
  if (column.category === undefined || column.zone === undefined) throw new Error('Use the Taxonomy Lookup tab: it needs Category and Zone columns.');
  const named = header.map((value, index) => ({ index, month: monthIndex(value), label: value })).filter((entry) => entry.month !== null).sort((a, b) => a.month - b.month);
  const known = new Set(Object.values(column));
  const lastNamed = Math.max(...Object.values(column));
  const trailing = named.length ? [] : header.map((value, index) => ({ index, label: value })).filter((entry) => entry.index > lastNamed && !entry.label && !known.has(entry.index));
  const monthly = named.length ? named : trailing.map((entry, position) => ({ ...entry, label: `Month ${position + 1}` }));
  const categories = [];
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const category = clean(row[column.category]);
    if (!category || seen.has(category.toLowerCase())) continue;
    seen.add(category.toLowerCase());
    const pick = (field) => (column[field] === undefined ? '' : clean(row[column[field]]));
    const months = monthly.map((entry) => ({ label: entry.label, count: integer(row[entry.index]) }));
    categories.push({
      category, articleCount: integer(pick('articleCount')), share: pick('share'), velocity: pick('velocity').toUpperCase() || 'DORMANT',
      last6Mo: integer(pick('last6Mo')), rate6Mo: pick('rate6Mo').toUpperCase(), saturation: pick('saturation').toUpperCase(),
      zone: TAXONOMY_ZONES.includes(pick('zone').toUpperCase()) ? pick('zone').toUpperCase() : 'OPEN',
      topKeywords: list(pick('topKeywords')), topPhrases: list(pick('topPhrases')), timeline: pick('timeline'),
      gapNotes: pick('gapNotes'), editorialAction: pick('editorialAction'), monthly: months,
    });
    if (categories.length >= MAX_CATEGORIES) break;
  }
  if (!categories.length) throw new Error('No taxonomy categories were found in that tab.');
  return categories;
}

function validateTaxonomy(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.categories)) throw new Error('The taxonomy must contain a list of categories.');
  if (input.categories.length > MAX_CATEGORIES) throw new Error(`Use at most ${MAX_CATEGORIES} taxonomy categories.`);
  const text = (value, max) => clean(value).slice(0, max);
  const categories = input.categories.map((entry) => {
    if (!entry || typeof entry !== 'object' || !clean(entry.category)) throw new Error('Every taxonomy category needs a name.');
    const words = (value) => (Array.isArray(value) ? value : list(value)).map((word) => text(word, 120).toLowerCase()).filter(Boolean).slice(0, 60);
    return {
      category: text(entry.category, 160), articleCount: Math.max(0, integer(entry.articleCount)), share: text(entry.share, 20), velocity: text(entry.velocity, 40).toUpperCase() || 'DORMANT',
      last6Mo: Math.max(0, integer(entry.last6Mo)), rate6Mo: text(entry.rate6Mo, 20).toUpperCase(), saturation: text(entry.saturation, 20).toUpperCase(),
      zone: TAXONOMY_ZONES.includes(clean(entry.zone).toUpperCase()) ? clean(entry.zone).toUpperCase() : 'OPEN',
      topKeywords: words(entry.topKeywords), topPhrases: words(entry.topPhrases), timeline: text(entry.timeline, 600), gapNotes: text(entry.gapNotes, 2000), editorialAction: text(entry.editorialAction, 2000),
      monthly: (Array.isArray(entry.monthly) ? entry.monthly : []).slice(-24).map((month) => ({ label: text(month?.label, 40), count: Math.max(0, integer(month?.count)) })),
    };
  });
  return { categories, source: input.source && typeof input.source === 'object' ? { kind: text(input.source.kind, 40), name: text(input.source.name, 240), importedAt: text(input.source.importedAt, 40) } : null };
}

// Synthesis context lines, exactly as "Aggregate Batch Candidates" builds them for the prompt.
function taxonomySummary(taxonomy) {
  const categories = taxonomy?.categories || [];
  return categories.map((entry) => `- ${entry.category} | Zone: ${entry.zone} | Keywords: ${entry.topKeywords.join(', ').slice(0, 100)} | Editorial: ${entry.editorialAction}`).join('\n');
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Claude-assigned category first (exact, then partial), then keyword (×1, word boundary) and
// phrase (×3) overlap with the theme name and description. Null when nothing matches.
function matchToTaxonomy(taxonomy, { name = '', description = '', category = '' } = {}) {
  const categories = taxonomy?.categories || [];
  if (!categories.length) return null;
  const assigned = clean(category).toLowerCase();
  if (assigned && assigned !== 'none') {
    const exact = categories.find((entry) => entry.category.toLowerCase() === assigned);
    if (exact) return { ...exact, matchMethod: 'claude_assigned' };
    const partial = categories.find((entry) => { const key = entry.category.toLowerCase(); return key.includes(assigned) || assigned.includes(key); });
    if (partial) return { ...partial, matchMethod: 'claude_partial' };
  }
  const text = `${name} ${description}`.toLowerCase();
  let best = null; let bestScore = 0;
  for (const entry of categories) {
    const keywordMatches = entry.topKeywords.filter((keyword) => keyword.length >= 3 && new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text));
    const phraseMatches = entry.topPhrases.filter((phrase) => phrase.length >= 3 && text.includes(phrase));
    const score = keywordMatches.length + phraseMatches.length * 3;
    if (score > bestScore) { bestScore = score; best = { ...entry, matchMethod: 'keyword_phrase_match', keywordMatches: keywordMatches.length, phraseMatches: phraseMatches.length, matchedPhrases: phraseMatches, totalScore: score }; }
  }
  return best && bestScore >= 1 ? best : null;
}

function deriveRecentTrend(match) {
  if (!match) return 'UNKNOWN';
  const monthly = Array.isArray(match.monthly) ? match.monthly : [];
  const last3 = monthly.slice(-3).reduce((sum, month) => sum + (Number(month.count) || 0), 0);
  if (last3 >= 10) return 'ACTIVE';
  if (last3 >= 3) return 'SPORADIC';
  if (last3 === 0 && match.velocity) {
    if (match.velocity === 'ACCELERATING') return 'ACTIVE';
    if (match.velocity === 'GROWING') return 'SPORADIC';
    return 'DORMANT';
  }
  return 'DORMANT';
}

function deriveGapSignal(match) {
  if (!match) return 'NEW_TERRITORY';
  const trend = deriveRecentTrend(match);
  if (match.zone === 'OPEN') return 'HIGH_OPPORTUNITY';
  if (match.zone === 'MODERATE') return trend === 'DORMANT' ? 'HIGH_OPPORTUNITY' : 'CHECK_RECENCY';
  if (match.zone === 'SATURATED') return trend === 'DORMANT' ? 'REFRESH_OPPORTUNITY' : 'LOW_OPPORTUNITY';
  return 'CHECK_RECENCY';
}

function phraseOverlap(match, { name = '', description = '' } = {}) {
  if (!match?.topPhrases?.length) return [];
  const text = `${name} ${description}`.toLowerCase();
  return match.topPhrases.filter((phrase) => phrase && phrase.length >= 3 && text.includes(phrase));
}

function velocityTier(count) { return count >= 3 ? 'ACCELERATING' : count === 2 ? 'EMERGING' : 'NEW'; }

// detectionCount = distinct runs that detected this theme, including the current one.
function scoreTheme({ theme = {}, detectionCount = 1, taxonomy = null } = {}) {
  const name = clean(theme.name); const description = clean(theme.description);
  const count = Math.max(1, integer(detectionCount));
  const velocity = velocityTier(count);
  const match = matchToTaxonomy(taxonomy, { name, description, category: theme.taxonomyCategory });
  const gapSignal = deriveGapSignal(match);
  const recentTrend = deriveRecentTrend(match);
  const overlap = phraseOverlap(match, { name, description });
  const gapScore = { NEW_TERRITORY: 5, HIGH_OPPORTUNITY: 4, REFRESH_OPPORTUNITY: 3, CHECK_RECENCY: 2, LOW_OPPORTUNITY: 1 }[gapSignal] || 2;
  const velocityScore = { ACCELERATING: 3, EMERGING: 2, NEW: 1 }[velocity] || 1;
  const noveltyScore = { 'NEW TOPIC': 3, 'NEW ANGLE': 2, EVERGREEN: 1 }[theme.novelty] || 1;
  const recencyBonus = { DORMANT: 1, SPORADIC: 0.5, ACTIVE: 0, UNKNOWN: 0.5 }[recentTrend] || 0;
  const phrasePenalty = overlap.length && gapSignal === 'LOW_OPPORTUNITY' ? -2 : 0;
  const raw = gapScore * 2 + velocityScore * 1.5 + noveltyScore + recencyBonus + phrasePenalty;
  const priorityTier = raw >= 14 ? 'FAST-TRACK' : raw >= 10 ? 'STRONG' : raw >= 7 ? 'MONITOR' : 'LOW';
  const autoRationale = [`${match?.articleCount || 0} articles`, `${match?.last6Mo || 0} in last 6mo`, `trend: ${recentTrend}`, overlap.length ? `phrases: ${overlap.join(', ')}` : 'no phrase overlap', `matched via: ${match?.matchMethod || 'no match'}`].join('; ');
  return {
    priorityTier, priorityScore: Math.round(raw * 10) / 10, gapSignal, velocity, count, recentTrend,
    phraseOverlap: overlap, gapRationale: clean(theme.gapRationale) || autoRationale, autoRationale,
    components: { gap: gapScore * 2, velocity: velocityScore * 1.5, novelty: noveltyScore, recency: recencyBonus, phrasePenalty },
    taxonomy: match ? { category: match.category, zone: match.zone, articleCount: match.articleCount, last6Mo: match.last6Mo, velocity: match.velocity, editorialAction: match.editorialAction, matchMethod: match.matchMethod } : { category: clean(theme.taxonomyCategory) || 'UNMAPPED', zone: 'UNKNOWN', articleCount: 0, last6Mo: 0, velocity: 'UNKNOWN', editorialAction: '', matchMethod: 'none' },
    basis: taxonomy?.categories?.length ? 'n8n-calculate-trend-velocity' : 'n8n-calculate-trend-velocity (no taxonomy loaded)',
  };
}

function themeNameIssues(name) {
  const value = clean(name); const lower = value.toLowerCase();
  const words = value.split(/\s+/).filter(Boolean).length;
  const issues = [];
  if (words > 6) issues.push(`too_long_${words}w`);
  if (words < 3) issues.push(`too_short_${words}w`);
  if (NAME_BANNED_WORDS.some((word) => lower.includes(word))) issues.push('generic_ai_speak');
  if (NAME_FILLER_STARTS.some((start) => lower.startsWith(start))) issues.push('filler_start');
  return issues;
}

// "To Rows (6)": clean names first, then cross-platform, then evidence.
function rankThemes(themes = []) {
  return [...themes].map((theme) => ({ theme, issues: themeNameIssues(theme.name) })).sort((a, b) => {
    const clean = (entry) => (entry.issues.length ? 1 : 0);
    if (clean(a) !== clean(b)) return clean(a) - clean(b);
    const cross = (entry) => (entry.theme.crossPlatform ? 0 : 1);
    if (cross(a) !== cross(b)) return cross(a) - cross(b);
    return (Number(b.theme.totalEvidence ?? b.theme.evidenceCount) || 0) - (Number(a.theme.totalEvidence ?? a.theme.evidenceCount) || 0);
  }).map((entry) => ({ ...entry.theme, nameIssues: entry.issues }));
}

// Deterministic guard for the matching agent's NAME QUALITY OVERRIDE: a clean name always
// beats a bloated one; between two clean names the agent's choice stands.
function preferredThemeName({ proposed, existing, original } = {}) {
  const candidates = [clean(proposed), clean(existing), clean(original)].filter(Boolean);
  if (!candidates.length) return '';
  const cleanOnes = candidates.filter((name) => !themeNameIssues(name).length);
  return cleanOnes.length ? cleanOnes[0] : candidates[0];
}

module.exports = { TAXONOMY_ZONES, RECENT_TRENDS, VELOCITY_TIERS, PRIORITY_TIERS, GAP_SIGNALS, NAME_BANNED_WORDS, NAME_FILLER_STARTS, parseTaxonomyRows, validateTaxonomy, taxonomySummary, matchToTaxonomy, deriveRecentTrend, deriveGapSignal, phraseOverlap, velocityTier, scoreTheme, themeNameIssues, rankThemes, preferredThemeName };
