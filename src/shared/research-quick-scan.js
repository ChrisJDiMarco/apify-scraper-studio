const { createHash } = require('node:crypto');
const research = require('./research-program');
const QUICK_SCAN = require('./quick-scan.json');

// Quick scans (SPEC §2): a small, hour-level research run sized from a chat request. Pure: no files, clocks or provider
// calls (`now` is passed in). The saved program is never changed; deriveQuickScanProgram returns a new program for one run.
//
// Preset tuning (quick-scan.json) against the Actor minimums and worst cases in research-collection.js, for a program
// with X, LinkedIn profile and Reddit groups and every preset slot filled:
// - lite (8 X / 6 LinkedIn / 4 Reddit, 60 rows, no comments): 2 X jobs + 1 LinkedIn + 1 Reddit need $0.09 to start and
//   cost at most about $0.73 (about $1.18 with a LinkedIn keyword search group), inside the $1.50 cap.
// - standard (20 / 15 / 8, 200 rows, 5 comments): about $3.10 worst case (about $4.60 with a keyword search), inside $5.
// - deep (50 / 40 / 20, 600 rows, 10 comments): about $12.60 worst case, inside $15.
// The AI cap also bounds how many calls run at once (see MIN_CALL_RESERVE_USD).
const PLATFORMS = ['x', 'linkedin', 'reddit'];
const DEPTHS = ['lite', 'standard', 'deep'];
const LABELS = QUICK_SCAN.platformLabels;
const MAX_TOPIC = 200;
const MAX_THEMES = { lite: 3, standard: 5, deep: 6 };
const OVERFETCH = 1.5; // request about 1.5× the rows kept, like research-collection's OVERFETCH_FACTOR
const RECENCY_DECAY = 0.7; // each older run counts 70% as much as the one after it
const SHORT_WINDOW_HOURS = 48; // below this, discovery engagement thresholds scale down with the window
const REDDIT_SUBS_PER_JOB = 10; // a scan's few communities share one job (one minimum charge)
// content-workspace ai() reserves at least $0.50 per call before it starts; more calls at once than the cap covers would fail.
const MIN_CALL_RESERVE_USD = 0.5;
const STOP_WORDS = new Set(['a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from', 'going', 'happening', 'has', 'have', 'how', 'in', 'into', 'is', 'it', 'its', 'last', 'latest', 'me', 'new', 'now', 'of', 'on', 'or', 'our', 'over', 'people', 'recent', 'saying', 'so', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to', 'today', 'trend', 'trends', 'up', 'us', 'was', 'we', 'were', 'what', 'whats', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your']);
const NOUNS = { x: ['account', 'accounts'], linkedin: ['profile', 'profiles'], reddit: ['community', 'communities'] };

function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;
const plural = (count, [one, many]) => (count === 1 ? one : many);
const stem = (word) => (word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
// Lower-case word tokens without stop words or accents, lightly singularized ("Overviews" → "overview").
function topicTerms(value) {
  const words = String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem))];
}
function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
const hoursText = (hours) => (hours === 1 ? 'hour' : hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`);

// preset → overrides → clamped to limits. Number fields take -1 (or any negative, or nothing) for "use the preset".
function normalizeScan(input, { presets = QUICK_SCAN.presets, limits = QUICK_SCAN.limits } = {}) {
  if (!isObject(input)) fail('scan', 'Describe the quick scan: a topic, a depth and the platforms.');
  if (input.topic != null && typeof input.topic !== 'string') fail('topic', 'The topic must be text.');
  const topic = String(input.topic || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!topic) fail('topic', 'Name a topic to scan for.');
  if (topic.length > MAX_TOPIC) fail('topic', `Keep the topic under ${MAX_TOPIC} characters.`);
  const depth = input.depth == null || input.depth === '' ? 'lite' : String(input.depth).trim().toLowerCase();
  if (!DEPTHS.includes(depth) || !isObject(presets?.[depth])) fail('depth', 'Choose a small, balanced or thorough scan.');
  const preset = presets[depth];
  if (input.platforms != null && !Array.isArray(input.platforms)) fail('platforms', 'Choose the platforms as a list: X, LinkedIn or Reddit.');
  const asked = list(input.platforms).map((value) => { const p = String(value ?? '').trim().toLowerCase(); return p === 'twitter' ? 'x' : p.startsWith('linkedin') ? 'linkedin' : p; });
  if (asked.some((p) => !PLATFORMS.includes(p))) fail('platforms', 'Choose X, LinkedIn or Reddit.');
  const platforms = asked.length ? PLATFORMS.filter((p) => asked.includes(p)) : [...PLATFORMS];
  const pick = (value, fallback, field, dollars = false) => {
    const range = limits?.[field]; if (!Array.isArray(range)) fail(field, `No limits are set for ${field}.`);
    const raw = value == null || value === '' ? -1 : typeof value === 'string' ? Number(value) : value;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(field, `${field} must be a number.`);
    const chosen = raw < 0 ? Number(fallback) : raw;
    if (!Number.isFinite(chosen)) fail(field, `The ${depth} preset has no ${field}.`);
    const bounded = clamp(chosen, range[0], range[1]);
    return dollars ? round2(bounded) : Math.round(bounded);
  };
  const targetsIn = isObject(input.maxTargets) ? input.maxTargets : typeof input.maxTargets === 'number' ? Object.fromEntries(PLATFORMS.map((p) => [p, input.maxTargets])) : {};
  const programId = input.programId == null ? '' : String(input.programId).trim();
  if (programId && !/^[a-zA-Z0-9_-]{1,180}$/.test(programId)) fail('programId', 'Choose a saved research program.');
  return {
    topic, depth, platforms,
    maxTargets: Object.fromEntries(PLATFORMS.map((p) => [p, pick(targetsIn[p], preset.maxTargets?.[p], 'maxTargets')])),
    itemsPerPlatform: pick(input.itemsPerPlatform, preset.itemsPerPlatform, 'itemsPerPlatform'),
    commentsPerPost: pick(input.commentsPerPost, preset.commentsPerPost, 'commentsPerPost'),
    lookbackHours: pick(input.lookbackHours, preset.lookbackHours ?? 24, 'lookbackHours'),
    aiBudgetUsd: pick(input.aiBudgetUsd, preset.aiBudgetUsd, 'aiBudgetUsd', true),
    collectionBudgetUsd: pick(input.collectionBudgetUsd, preset.collectionBudgetUsd, 'collectionBudgetUsd', true),
    programId,
  };
}

// The evidence keys a retained post counts toward: the X handle, the LinkedIn profile id (author or URL), the subreddit.
function sourceKeys(item) {
  const p = String(item?.platform || '').toLowerCase();
  if (p === 'x') { const handle = String(item.author || '').trim().toLowerCase().replace(/^@/, ''); return handle ? [`x:${handle}`] : []; }
  if (p === 'reddit') { const community = String(item.community || '').trim().toLowerCase().replace(/^\/?r\//, ''); return community ? [`reddit:${community}`] : []; }
  if (p !== 'linkedin') return [];
  const keys = new Set(); const author = String(item.author || '').trim().toLowerCase(); if (author) keys.add(`linkedin:${author}`);
  const url = String(item.url || '').toLowerCase();
  for (const pattern of [/\/(?:in|company)\/([^/?#]+)/, /\/posts\/([^/?#]+?)_/]) { const match = url.match(pattern); if (match) keys.add(`linkedin:${safeDecode(match[1])}`); }
  return [...keys];
}
// The name a saved target is known by in evidence: a handle, a subreddit, or the last segment of a LinkedIn URL.
function targetName(platform, target) {
  if (platform !== 'linkedin') return String(target).toLowerCase();
  return safeDecode(String(target).replace(/\/$/, '').split('/').at(-1) || '').toLowerCase();
}
// A topic term in the target's own name ("bigseo" for "SEO"): whole tokens, or substrings of three letters or more.
function nameMatch(name, wanted) {
  const tokens = new Set(topicTerms(name.replace(/[_-]+/g, ' '))); const flat = name.replace(/[^\p{L}\p{N}]+/gu, '');
  return wanted.find((term) => tokens.has(term) || (term.length >= 3 && flat.includes(term))) || '';
}
// evidence: [{ runId, createdAt, items }] newest first (a flat list of items counts as one run).
function runsOf(evidence) {
  const rows = list(evidence);
  return rows.length && rows.every((row) => isObject(row) && Array.isArray(row.items)) ? rows : rows.length ? [{ runId: '', items: rows }] : [];
}

// Scores every saved target in the program's enabled account groups for this topic, deterministically and for free:
// past retained posts from the target that mention the topic (each older run weighted 0.7× the next), then a topic term
// in the target's name, then how active it was lately, then saved order. LinkedIn keyword-search groups hold phrases,
// not accounts, so they are not ranked (a scan searches the topic instead).
function rankTargetsForTopic({ program, topic, evidence = [] } = {}) {
  const saved = research.validateResearchProgram(program);
  const wanted = topicTerms(topic); const need = Math.max(1, Math.ceil(wanted.length / 2));
  const runs = runsOf(evidence);
  // Integer tallies per run, combined in run order, so the result never depends on the order of posts within a run.
  const tally = new Map();
  runs.forEach((run, index) => {
    for (const item of list(run.items)) {
      const keys = sourceKeys(item); if (!keys.length) continue;
      const own = new Set(topicTerms(`${item.title || ''} ${item.text || ''}`));
      const hits = wanted.filter((term) => own.has(term)).length; const matched = wanted.length > 0 && hits >= need;
      for (const key of keys) {
        let row = tally.get(key); if (!row) { row = runs.map(() => ({ posts: 0, matched: 0, hits: 0 })); tally.set(key, row); }
        row[index].posts++; if (matched) { row[index].matched++; row[index].hits += hits; }
      }
    }
  });
  const entries = []; let order = 0;
  for (const group of saved.sourceGroups) {
    if (!group.enabled || group.sourceId === 'linkedin-search') continue;
    for (const target of group.targets) {
      const name = targetName(group.platform, target); const row = tally.get(`${group.platform}:${name}`) || [];
      let topicScore = 0; let activity = 0; let matched = 0; let posts = 0; let runCount = 0;
      row.forEach((cell, index) => { const weight = RECENCY_DECAY ** index; topicScore += weight * cell.hits / Math.max(1, wanted.length); activity += weight * cell.posts; matched += cell.matched; posts += cell.posts; if (cell.matched) runCount++; });
      const nameHit = nameMatch(name, wanted);
      const reasons = [];
      if (matched) reasons.push(`${matched} recent ${plural(matched, ['post', 'posts'])} on this topic${runCount > 1 ? ` across ${runCount} runs` : ''}`);
      if (nameHit) reasons.push(`Name matches “${nameHit}”`);
      if (!matched && posts) reasons.push(`Active lately (${posts} ${plural(posts, ['post', 'posts'])}), none on this topic`);
      if (!matched && !posts && !nameHit) reasons.push(runs.length ? 'No posts in recent runs; kept in saved order' : 'No earlier runs to learn from; kept in saved order');
      entries.push({ sourceGroupId: group.id, sourceId: group.sourceId, platform: group.platform, target, score: round2(topicScore), reasons, sort: [topicScore, nameHit ? 1 : 0, activity, order++] });
    }
  }
  entries.sort((a, b) => b.sort[0] - a.sort[0] || b.sort[1] - a.sort[1] || b.sort[2] - a.sort[2] || a.sort[3] - b.sort[3]);
  return entries.map(({ sort: _sort, ...entry }) => entry);
}

// The targets a scan collects: per chosen platform, the top maxTargets accounts in ranking order (saved order without a
// ranking, duplicates across groups once), plus one keyword search for the topic where the program has a LinkedIn
// keyword-search group. Platforms the program has no sources for are left out with a warning.
function selectQuickScanTargets(program, scan, ranking = []) {
  const saved = research.validateResearchProgram(program);
  const rankOf = new Map(list(ranking).map((entry, index) => [`${entry.sourceGroupId}\n${entry.target}`, { entry, index }]));
  const platforms = []; const targets = []; const byGroup = {}; const available = {}; const warnings = [];
  for (const p of scan.platforms) {
    const groups = saved.sourceGroups.filter((group) => group.enabled && group.platform === p);
    const pool = groups.filter((group) => group.sourceId !== 'linkedin-search').flatMap((group) => group.targets.map((target) => ({ group, target })))
      .map((row, order) => ({ ...row, order, ranked: rankOf.get(`${row.group.id}\n${row.target}`) }))
      .sort((a, b) => (a.ranked ? a.ranked.index : Infinity) - (b.ranked ? b.ranked.index : Infinity) || a.order - b.order);
    const seen = new Set(); const unique = [];
    for (const row of pool) if (!seen.has(row.target)) { seen.add(row.target); unique.push(row); }
    available[p] = unique.length;
    const chosen = unique.slice(0, scan.maxTargets[p]);
    for (const row of chosen) {
      (byGroup[row.group.id] ||= []).push(row.target);
      targets.push({ sourceGroupId: row.group.id, sourceId: row.group.sourceId, platform: p, target: row.target, score: row.ranked?.entry.score ?? 0, reasons: row.ranked?.entry.reasons || ['Kept in saved order'] });
    }
    const search = groups.find((group) => group.sourceId === 'linkedin-search');
    if (search) {
      byGroup[search.id] = [scan.topic];
      targets.push({ sourceGroupId: search.id, sourceId: 'linkedin-search', platform: p, target: scan.topic, score: 0, reasons: ['Searches LinkedIn posts for the topic instead of the saved phrases'] });
    }
    if (!chosen.length && !search) { warnings.push(`This program has no ${LABELS[p]} sources, so the scan leaves ${LABELS[p]} out.`); continue; }
    platforms.push(p);
  }
  return { platforms, targets, byGroup, available, warnings };
}

// The cheapest model marked discovery-capable, priced on a typical discovery call at low effort.
function cheapestDiscoveryModel() {
  const capable = research.RESEARCH_MODELS.filter((model) => model.discovery);
  const cost = (model) => research.callCost(model.id, 'low', 50000, 10000);
  return [...capable].sort((a, b) => cost(a) - cost(b) || a.id.localeCompare(b.id))[0]?.id || research.DEFAULT_RESEARCH_AI.models.discovery;
}
function scanOptions(group, comments) {
  if (group.sourceId === 'x') return { ...(group.options || {}) };
  const { includeComments: _c, maxComments: _m, includeReactions: _r, maxReactions: _mr, ...rest } = group.options || {};
  // Reactions are never evidence (prepareResearchEvidence drops them) and cost money, so a scan turns them off.
  return { ...rest, includeComments: comments > 0, ...(comments > 0 ? { maxComments: comments } : {}), ...(group.sourceId === 'reddit' ? {} : { includeReactions: false }) };
}

// A new program for one quick scan run, built from the saved one: chosen platforms and top-N targets only, collection
// knobs sized from itemsPerPlatform, an hour-level window ending now, manual schedule, the scan's budgets, no automatic
// approval and 3/5/6 themes by depth. The result passes validateResearchProgram; the saved program is not modified.
function deriveQuickScanProgram(savedProgram, scan, { ranking = [], now = new Date(), presets, limits } = {}) {
  const saved = research.validateResearchProgram(savedProgram);
  const s = normalizeScan(scan, { presets, limits });
  const at = new Date(now); if (!Number.isFinite(at.getTime())) fail('now', 'A valid scan time is required.');
  const selection = selectQuickScanTargets(saved, s, ranking);
  if (!selection.platforms.length) fail('platforms', `This program has no ${s.platforms.map((p) => LABELS[p]).join(', ')} sources. Add sources to the program or choose other platforms.`);
  const items = s.itemsPerPlatform; const comments = s.commentsPerPost; const hours = s.lookbackHours;
  const count = (p) => selection.targets.filter((t) => t.platform === p && t.sourceId !== 'linkedin-search').length;
  const handles = count('x'); const profiles = count('linkedin'); const subs = count('reddit');
  // About 1.5× the kept rows are requested, split across the chosen accounts; with comments on, each post brings up to
  // `comments` more rows, so fewer posts per account are requested and the platform still keeps about itemsPerPlatform.
  const per = (accounts, rows = 1) => Math.ceil(items * OVERFETCH / Math.max(1, accounts * rows));
  const collection = {
    ...saved.collection,
    xMaxItemsPerHandle: clamp(per(handles), 10, 1000),
    linkedinPostsPerProfile: clamp(per(profiles, 1 + comments), 1, 100),
    redditPostsPerSub: clamp(per(subs, 1 + comments), 10, 1000),
    redditSubsPerJob: clamp(Math.max(saved.collection.redditSubsPerJob, REDDIT_SUBS_PER_JOB), 1, 50),
    // The newest posts sit at the top of /new/, so a short window needs far less scrolling.
    redditScrollTimeoutSecs: Math.min(saved.collection.redditScrollTimeoutSecs, hours <= 24 ? 90 : hours <= 72 ? 180 : 600),
  };
  // The per-author cap must not starve a few accounts below their share of the kept rows.
  const perAuthorCap = clamp(Math.max(saved.perAuthorCap, handles ? per(handles) : 0, profiles ? per(profiles) : 0), 1, 1000);
  // Posts only hours old have little engagement yet, so windows under two days scale the discovery bar with the window.
  const discovery = hours < SHORT_WINDOW_HOURS ? Object.fromEntries(PLATFORMS.map((p) => [p, Math.floor(saved.thresholds.discovery[p] * hours / SHORT_WINDOW_HOURS)])) : { ...saved.thresholds.discovery };
  const lite = s.depth === 'lite'; const cheap = lite ? cheapestDiscoveryModel() : '';
  const used = { discovery: cheap || saved.ai.models.discovery, synthesis: cheap || saved.ai.models.synthesis, matching: cheap || saved.ai.models.matching };
  const ai = {
    // Tagging and reports never run in a quick scan; they mirror the synthesis model so the host's model check before the
    // start only asks about models the scan calls.
    models: { ...used, tagging: used.synthesis, reports: used.synthesis },
    effort: lite ? Object.fromEntries(research.RESEARCH_STAGES.map((stage) => [stage, 'low'])) : { ...saved.ai.effort },
    concurrency: clamp(Math.floor(s.aiBudgetUsd / MIN_CALL_RESERVE_USD), 1, saved.ai.concurrency),
  };
  const startAt = new Date(Math.floor((at.getTime() - hours * 3600000) / 1000) * 1000).toISOString();
  const name = `Quick scan · ${s.topic}`;
  return research.validateResearchProgram({
    id: saved.id, name: name.length > 160 ? `${name.slice(0, 159).replace(/[\uD800-\uDBFF]$/, '')}…` : name, query: s.topic,
    sourceGroups: saved.sourceGroups.filter((group) => selection.byGroup[group.id]).map((group) => ({ ...group, targets: selection.byGroup[group.id], enabled: true, options: scanOptions(group, comments) })),
    window: { startDate: startAt.slice(0, 10), endDate: '', startAt }, lookbackHours: hours, schedule: { frequency: 'manual', enabled: false },
    targetPerPlatform: items, maxEvidenceItems: Math.max(1, items * selection.platforms.length), perAuthorCap, lookbackDays: saved.lookbackDays,
    discoveryBatchSize: saved.discoveryBatchSize, taggingBatchSize: saved.taggingBatchSize, taggingBatchSizes: { ...saved.taggingBatchSizes }, maxThemes: MAX_THEMES[s.depth],
    confidenceThreshold: saved.confidenceThreshold, autoAcceptThreshold: saved.autoAcceptThreshold, includeUndated: saved.includeUndated, topicFiltersTargets: saved.topicFiltersTargets, autoApproveThemes: false,
    budgets: { collectionUsd: s.collectionBudgetUsd, aiUsd: s.aiBudgetUsd }, thresholds: { discovery, tagging: { ...saved.thresholds.tagging } },
    ai, collection, delivery: { publishToDrive: false },
  });
}

function displayName(platform, sourceId, target) {
  if (sourceId === 'linkedin-search') return `“${target}”`;
  return platform === 'x' ? `@${target}` : platform === 'reddit' ? `r/${target}` : targetName('linkedin', target);
}
// Plain lines for a confirmation. plan: { platforms, targets, available?, ai?, collection?, uncapped? } (estimateQuickScan).
function describeScan(scan, plan = {}) {
  const preset = QUICK_SCAN.presets[scan.depth] || {};
  const lines = [`${preset.label || 'Quick'} scan of “${scan.topic}” over the last ${hoursText(scan.lookbackHours)}.`];
  const targets = list(plan.targets);
  for (const p of list(plan.platforms).length ? plan.platforms : scan.platforms) {
    const own = targets.filter((t) => t.platform === p);
    const accounts = own.filter((t) => t.sourceId !== 'linkedin-search'); const search = own.some((t) => t.sourceId === 'linkedin-search');
    const parts = [];
    if (accounts.length) {
      const names = accounts.slice(0, 3).map((t) => displayName(p, t.sourceId, t.target)).join(', ');
      const more = accounts.length > 3 ? ` and ${accounts.length - 3} more` : '';
      const of = plan.available?.[p] > accounts.length ? ` of ${plan.available[p]}` : '';
      parts.push(`${accounts.length}${of} ${plural(accounts.length, NOUNS[p])} (${names}${more})`);
    }
    if (search) parts.push('a keyword search for the topic');
    if (parts.length) lines.push(`${LABELS[p]}: ${parts.join(' and ')}.`);
  }
  lines.push(scan.commentsPerPost ? `Keeps up to ${scan.itemsPerPlatform} posts and comments from each platform, with up to ${scan.commentsPerPost} comments per LinkedIn or Reddit post.` : `Keeps up to ${scan.itemsPerPlatform} posts from each platform, without comments.`);
  if (plan.ai) lines.push(plan.uncapped ? `AI: about ${money(plan.ai.totalUsd)}. Codex doesn't report cost, so the ${money(scan.aiBudgetUsd)} cap can't stop it.` : `AI: about ${money(plan.ai.totalUsd)}, capped at ${money(scan.aiBudgetUsd)}.`);
  else lines.push(`AI capped at ${money(scan.aiBudgetUsd)}${plan.uncapped ? ' (Codex spend is not capped)' : ''}.`);
  lines.push(plan.collection && !plan.collection.error ? `Apify: up to ${money(plan.collection.worstCaseUsd)} in the worst case, capped at ${money(scan.collectionBudgetUsd)}.` : `Apify capped at ${money(scan.collectionBudgetUsd)}.`);
  lines.push('Stops once trends are found: no review, tagging or reports, and the saved program is not changed.');
  return lines;
}

// Same plan, same fingerprint: sha256 of the derived program without its time fields (window start, updatedAt), with
// keys sorted, so a cost check and the start a minute later agree unless the targets, sizes or budgets changed.
function scanFingerprint(program) {
  const stable = (value) => (Array.isArray(value) ? value.map(stable) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value);
  const { window = {}, updatedAt: _updatedAt, ...rest } = isObject(program) ? program : {};
  const { startAt: _startAt, startDate: _startDate, ...lasting } = isObject(window) ? window : {};
  return createHash('sha256').update(JSON.stringify(stable({ ...rest, window: lasting }))).digest('hex');
}

module.exports = { QUICK_SCAN, QUICK_SCAN_PLATFORMS: PLATFORMS, QUICK_SCAN_DEPTHS: DEPTHS, MIN_CALL_RESERVE_USD, topicTerms, normalizeScan, rankTargetsForTopic, selectQuickScanTargets, cheapestDiscoveryModel, deriveQuickScanProgram, describeScan, scanFingerprint };
