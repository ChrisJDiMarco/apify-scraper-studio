const { createHash } = require('node:crypto');
const { validateResearchProgram, resolveResearchWindow } = require('./research-program');
const { buildSearchRecipes, SOURCE_CATALOG, OPTION_KEYS } = require('./source-catalog');

// Trusted server-side collection plan. Actor inputs reproduce the n8n "Golden Thread" Sources
// nodes exactly (X `from:<handle> since:<date>`, LinkedIn profile posts with postedLimitDate,
// Reddit /r/<sub>/new/ listings), and every lane collects concurrently like the n8n launch step.
const MAX_JOB_PROVIDER_ROWS = 10000;
const MAX_PLANNED_PROVIDER_ROWS = 100000;
const OVERFETCH_FACTOR = 1.5;
// Apify list prices on the FREE tier (checked 2026-10-07); used for worst-case planning only.
const ACTOR_PRICING = {
  'apidojo/twitter-scraper-lite': { perQuery: 0.016, itemTiers: [[5, 0.0004], [10, 0.0008], [30, 0.0012], [100, 0.0016], [Infinity, 0.002]], minimumCharge: 0.02 },
  'harvestapi/linkedin-profile-posts': { perPost: 0.002, perComment: 0.002, perReaction: 0.002, start: 0.00005, minimumCharge: 0.002 },
  'trudax/reddit-scraper-lite': { perResult: 0.004, start: 0.02, minimumCharge: 0.04 },
  'supreme_coder/linkedin-post': { perResult: 0.005, minimumCharge: 0.01, estimated: true },
};
// n8n server-side timeouts and the client wall-clock abort (timeout + 5 minutes).
const LANE_TIMEOUTS = { x: 1200, 'linkedin-profile': 5400, reddit: 7200, 'linkedin-search': 3600 };
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
function split(items, size) { const result = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }
const catalog = (id) => SOURCE_CATALOG.find((source) => source.id === id);
const cents = (value) => Math.round(value * 100) / 100;
function checkOptions(sourceId, options) {
  for (const key of Object.keys(options || {})) if (!OPTION_KEYS[sourceId].includes(key)) fail(`sourceOptions.${sourceId}.${key}`, `The ${sourceId} source does not support the ${key} option.`);
}
function choice(options, key, values, fallback, sourceId) {
  const value = options[key] === undefined ? fallback : options[key];
  if (!values.includes(value)) fail(`sourceOptions.${sourceId}.${key}`, `Choose a supported ${key} option: ${values.join(', ')}.`);
  return value;
}
function count(options, key, fallback, sourceId) {
  const value = options[key] === undefined ? fallback : Number(options[key]);
  if (!Number.isInteger(value) || value < 1 || value > 100) fail(`sourceOptions.${sourceId}.${key}`, `Choose 1 to 100 for ${key}.`);
  return value;
}
const xItemPrice = (queries) => ACTOR_PRICING['apidojo/twitter-scraper-lite'].itemTiers.find(([limit]) => queries <= limit)[1];
const untilDate = (endDate) => new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);

function xJobs(group, program, window) {
  const options = group.options || {}; checkOptions('x', options);
  const sort = choice(options, 'sort', ['Latest', 'Top', 'Latest + Top'], 'Latest', 'x');
  const replies = choice(options, 'replies', ['all', 'exclude', 'only'], 'all', 'x');
  const media = choice(options, 'media', ['all', 'media', 'images', 'videos', 'links'], 'all', 'x');
  const topic = program.topicFiltersTargets && program.query ? `(${program.query})` : '';
  const filters = [`since:${window.startDate}`, ...(window.endDate ? [`until:${untilDate(window.endDate)}`] : []), ...(replies === 'all' ? [] : [`${replies === 'exclude' ? '-' : ''}filter:replies`]), ...(media === 'all' ? [] : [`filter:${media}`]), ...(options.includeRetweets === undefined ? [] : [options.includeRetweets ? 'include:nativeretweets' : '-filter:nativeretweets'])];
  return split(group.targets, program.collection.xHandlesPerJob).map((handles) => {
    const maxItems = Math.min(MAX_JOB_PROVIDER_ROWS, Math.max(handles.length * 10, handles.length * program.collection.xMaxItemsPerHandle));
    const input = { searchTerms: handles.map((handle) => [topic, `from:${handle}`, ...filters].filter(Boolean).join(' ')), sort, maxItems, includeSearchTerms: true };
    const worstCaseUsd = handles.length * ACTOR_PRICING['apidojo/twitter-scraper-lite'].perQuery + maxItems * xItemPrice(handles.length);
    return { targets: handles, query: topic ? program.query : '', input, plannedPosts: maxItems, plannedProviderRows: maxItems, worstCaseUsd };
  });
}
function linkedinProfileJobs(group, program, window) {
  const options = group.options || {}; checkOptions('linkedin-profile', options);
  const comments = options.includeComments === true ? count(options, 'maxComments', 5, 'linkedin-profile') : 0;
  const reactions = options.includeReactions === true ? count(options, 'maxReactions', 5, 'linkedin-profile') : 0;
  const posts = program.collection.linkedinPostsPerProfile; const rowsPerProfile = posts * (1 + comments + reactions);
  if (rowsPerProfile > MAX_JOB_PROVIDER_ROWS) fail('sourceGroups.options', 'One LinkedIn account would exceed 10,000 provider rows. Reduce comment or reaction limits.');
  const perJob = Math.max(1, Math.min(program.collection.linkedinProfilesPerJob, Math.floor(MAX_JOB_PROVIDER_ROWS / rowsPerProfile)));
  const pricing = ACTOR_PRICING['harvestapi/linkedin-profile-posts'];
  return split(group.targets, perJob).map((urls) => {
    // n8n [LI] Sources: strip ?trk= and force a trailing slash.
    const targetUrls = urls.map((url) => `${String(url).split('?')[0].replace(/\/?$/, '/')}`);
    const input = { targetUrls, maxPosts: posts, postedLimitDate: `${window.startDate}T00:00:00.000Z`, scrapeReactions: reactions > 0, scrapeComments: comments > 0 };
    if (comments) Object.assign(input, { maxComments: comments, commentsPostedLimit: choice(options, 'commentsPostedLimit', ['any', '1h', '24h', 'week', 'month'], 'any', 'linkedin-profile') });
    if (reactions) input.maxReactions = reactions;
    if (options.includeQuotePosts !== undefined) input.includeQuotePosts = options.includeQuotePosts === true;
    if (options.includeReposts !== undefined) input.includeReposts = options.includeReposts === true;
    if (options.contextCountry !== undefined && options.contextCountry !== 'any') input.contextCountry = choice(options, 'contextCountry', ['any', 'US', 'GB', 'DE', 'FR'], 'any', 'linkedin-profile');
    const plannedPosts = posts * urls.length; const plannedProviderRows = rowsPerProfile * urls.length;
    const worstCaseUsd = pricing.start + plannedPosts * pricing.perPost + plannedPosts * (comments * pricing.perComment + reactions * pricing.perReaction);
    return { targets: urls, query: '', input, plannedPosts, plannedProviderRows, worstCaseUsd };
  });
}
function redditJobs(group, program, window) {
  const options = group.options || {}; checkOptions('reddit', options);
  const includeComments = options.includeComments === true;
  const maxComments = includeComments ? count(options, 'maxComments', 75, 'reddit') : 75;
  const maxItems = Math.min(MAX_JOB_PROVIDER_ROWS, Math.ceil(program.targetPerPlatform * OVERFETCH_FACTOR * (includeComments ? 4 : 1)));
  const startIso = `${window.startDate}T00:00:00.000Z`;
  const pricing = ACTOR_PRICING['trudax/reddit-scraper-lite'];
  const base = { maxItems, maxPostCount: program.collection.redditPostsPerSub, maxComments, skipComments: !includeComments, scrollTimeout: program.collection.redditScrollTimeoutSecs, navigationTimeout: 60, includeMediaLinks: options.includeMediaLinks !== false, includeNSFW: options.includeNSFW === true, skipCommunity: true, skipUserPosts: true, proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } };
  if (program.topicFiltersTargets && program.query) {
    // Opt-in keyword mode: search the program topic inside these communities, newest first.
    const scope = group.targets.map((name) => `subreddit:${name}`).join(' OR ');
    const input = { ...base, searches: [`(${program.query}) AND (${scope})`], startUrls: [], searchPosts: true, searchComments: options.searchComments === true, searchCommunities: false, searchUsers: false, searchMedia: false, sort: 'new', postDateLimit: window.startDate, ...(includeComments ? { commentDateLimit: window.startDate } : {}) };
    return [{ targets: group.targets, query: program.query, input, plannedPosts: maxItems, plannedProviderRows: maxItems, worstCaseUsd: pricing.start + maxItems * pricing.perResult }];
  }
  // Unlike n8n's single run, subreddits go in groups (redditSubsPerJob) that collect in parallel, so a
  // longer scroll per listing still finishes well inside the lane timeout. Each group keeps n8n's maxItems;
  // a /new/ listing stops at maxPostCount posts (plus maxComments per post with comments on), so a short
  // group can never cost its full maxItems.
  return split(group.targets, program.collection.redditSubsPerJob).map((subs) => {
    const input = { ...base, startUrls: subs.map((name) => ({ url: `https://www.reddit.com/r/${name}/new/` })), postDateLimit: startIso, commentDateLimit: startIso, ignoreStartUrls: false, debugMode: false };
    const posts = Math.min(maxItems, subs.length * program.collection.redditPostsPerSub);
    const results = Math.min(maxItems, posts * (includeComments ? 1 + maxComments : 1));
    return { targets: subs, query: '', input, plannedPosts: posts, plannedProviderRows: maxItems, worstCaseUsd: pricing.start + results * pricing.perResult };
  });
}
function linkedinSearchJobs(group, program, window) {
  const queries = group.targets.length ? group.targets : [program.query];
  return queries.map((query) => {
    const seed = buildSearchRecipes({ query, platformIds: ['linkedin-search'], maxItems: 50, maxTotalChargeUsd: 0.01, sourceOptions: { 'linkedin-search': { ...group.options, startDate: window.startDate } } }).recipes[0];
    const limit = Math.min(MAX_JOB_PROVIDER_ROWS, Math.ceil(program.targetPerPlatform * OVERFETCH_FACTOR / queries.length));
    return { targets: [], query, input: { ...seed.input, limitPerSource: limit }, plannedPosts: limit, plannedProviderRows: limit, worstCaseUsd: limit * ACTOR_PRICING['supreme_coder/linkedin-post'].perResult };
  });
}
const BUILDERS = { x: xJobs, 'linkedin-profile': linkedinProfileJobs, reddit: redditJobs, 'linkedin-search': linkedinSearchJobs };
const ACTOR_FOR = { x: 'apidojo/twitter-scraper-lite', 'linkedin-profile': 'harvestapi/linkedin-profile-posts', reddit: 'trudax/reddit-scraper-lite', 'linkedin-search': 'supreme_coder/linkedin-post' };

function buildCollectionPlan(input, { now = new Date() } = {}) {
  const program = validateResearchProgram(input);
  const window = resolveResearchWindow(program, now);
  const groups = program.sourceGroups.filter((group) => group.enabled);
  if (!groups.length) fail('sourceGroups', 'Enable at least one source group before collecting.');
  const drafts = [];
  for (const group of groups) for (const [index, job] of BUILDERS[group.sourceId](group, program, window).entries()) drafts.push({ ...job, group, groupJobIndex: index + 1 });
  if (!drafts.length) fail('sourceGroups', 'No collection jobs could be planned.');
  if (drafts.reduce((sum, job) => sum + job.plannedProviderRows, 0) > MAX_PLANNED_PROVIDER_ROWS) fail('sourceGroups.options', 'This plan exceeds 100,000 provider rows. Reduce target, comment, or reaction limits.');
  const warnings = [];
  // Each job's spend cap is its share of the collection budget, weighted by its worst-case cost,
  // never below the Actor's minimum charge (a lower cap makes the Actor stop before its first result).
  const worstCaseUsd = drafts.reduce((sum, job) => sum + job.worstCaseUsd, 0);
  const minimums = drafts.map((job) => Math.max(0.01, ACTOR_PRICING[ACTOR_FOR[job.group.sourceId]].minimumCharge));
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  if (program.budgets.collectionUsd + 1e-9 < minimumTotal) fail('budgets.collectionUsd', `This source roster needs ${drafts.length} Actor jobs and at least $${cents(minimumTotal).toFixed(2)} so every Actor can start. Raise the collection budget.`);
  const budgets = drafts.map((job, index) => Math.min(100, Math.max(minimums[index], Math.floor((program.budgets.collectionUsd * job.worstCaseUsd / Math.max(worstCaseUsd, 1e-9)) * 100) / 100)));
  if (program.budgets.collectionUsd < worstCaseUsd) warnings.push(`The $${program.budgets.collectionUsd.toFixed(2)} collection budget is below the worst-case Apify cost of about $${cents(worstCaseUsd).toFixed(2)}. Each source stops when its share runs out; typical weeks cost less than the worst case.`);
  const jobs = drafts.map((draft, index) => {
    const { group } = draft; const source = catalog(group.sourceId); const budgetUsd = cents(budgets[index]);
    const timeoutSecs = LANE_TIMEOUTS[group.sourceId];
    const id = `collection-${hash(`${program.id}:${group.id}:${index}:${JSON.stringify(draft.input)}:${budgetUsd}`)}`;
    const postFilter = { ...window, perAuthorCap: program.perAuthorCap, targetPerPlatform: program.targetPerPlatform, maxEvidenceItems: program.maxEvidenceItems, includeUndated: program.includeUndated };
    const dateSemantics = group.sourceId === 'x' ? 'X search uses since: (and until: for an end date) on whole UTC days.' : group.sourceId === 'reddit' ? 'Reddit /new/ listings stop at the window start; the program window is enforced again after collection.' : 'LinkedIn posts newer than the window start; the program window is enforced again after collection.';
    const researchContext = { programId: program.id, sourceGroupId: group.id, sourceId: group.sourceId, query: draft.query, targets: draft.targets, plannedPosts: draft.plannedPosts, plannedProviderRows: draft.plannedProviderRows, worstCaseUsd: cents(draft.worstCaseUsd), postFilter, sourceOptions: group.options || {}, dateSemantics, warnings: [] };
    const recipe = { name: `${program.name} · ${group.name} · ${draft.groupJobIndex}`, platform: source.platform, actorId: source.actorId, taskId: '', input: draft.input, mapper: { ...source.mapper }, proxyNote: source.scopeNote, runOptions: { maxTotalChargeUsd: budgetUsd, timeoutSecs }, researchContext };
    return { id, sourceGroupId: group.id, sourceId: group.sourceId, platform: group.platform, lane: group.platform, targets: draft.targets, query: draft.query, recipe, maxItems: draft.plannedProviderRows, plannedPosts: draft.plannedPosts, plannedProviderRows: draft.plannedProviderRows, budgetUsd, worstCaseUsd: cents(draft.worstCaseUsd), abortAfterSecs: timeoutSecs + 300, postFilter };
  });
  const platforms = {};
  for (const job of jobs) {
    platforms[job.platform] ||= { jobCount: 0, targetCount: 0, retainedTarget: program.targetPerPlatform, plannedPosts: 0, plannedProviderRows: 0, budgetUsd: 0, worstCaseUsd: 0 };
    const p = platforms[job.platform]; p.jobCount++; p.targetCount += job.targets.length; p.plannedPosts += job.plannedPosts; p.plannedProviderRows += job.plannedProviderRows; p.budgetUsd = cents(p.budgetUsd + job.budgetUsd); p.worstCaseUsd = cents(p.worstCaseUsd + job.worstCaseUsd);
  }
  if (window.endDate && groups.some((g) => g.sourceId !== 'x')) warnings.push('Reddit and LinkedIn do not support an end date in the Actor query. The end date is enforced after retrieval, so newer excluded rows can consume the collection allowance.');
  if (Object.keys(platforms).length * program.targetPerPlatform > program.maxEvidenceItems) warnings.push(`The combined platform targets exceed the ${program.maxEvidenceItems}-item retained evidence cap; newest retained evidence is kept first.`);
  if (program.query && !program.topicFiltersTargets && groups.some((g) => g.sourceId !== 'linkedin-search')) warnings.push('The research focus guides the AI analysis only. Account and community collection is not filtered by it (the n8n behavior); turn on topic filtering to narrow collection.');
  if (window.resolvedFrom === 'lookback') warnings.push(`No start date is saved, so this run searches the last ${window.lookbackDays} days (from ${window.startDate}).`);
  warnings.push('Planned counts are maximum requests, not guaranteed results. Spend caps, source activity, unavailable accounts, duplicate posts, and author limits can reduce retained evidence.');
  const totalBudgetUsd = cents(jobs.reduce((sum, job) => sum + job.budgetUsd, 0));
  return { programId: program.id, window, jobs, receipt: { jobCount: jobs.length, requestedBudgetUsd: program.budgets.collectionUsd, totalBudgetUsd, worstCaseUsd: cents(worstCaseUsd), totalPlannedPosts: jobs.reduce((sum, job) => sum + job.plannedPosts, 0), totalPlannedProviderRows: jobs.reduce((sum, job) => sum + job.plannedProviderRows, 0), retainedEvidenceCap: program.maxEvidenceItems, window, platforms, laneConcurrency: program.collection.laneConcurrency, warnings } };
}
module.exports = { buildCollectionPlan, ACTOR_PRICING, LANE_TIMEOUTS, MAX_JOB_PROVIDER_ROWS, MAX_PLANNED_PROVIDER_ROWS, OVERFETCH_FACTOR };
