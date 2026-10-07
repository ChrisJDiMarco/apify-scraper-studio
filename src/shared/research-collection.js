const { createHash } = require('node:crypto');
const { validateResearchProgram } = require('./research-program');
const { buildSearchRecipes } = require('./source-catalog');

const MAX_JOB_PROVIDER_ROWS = 10000;
const MAX_PLANNED_PROVIDER_ROWS = 100000;
const OVERFETCH_FACTOR = 1.5;
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
function split(items, size) { const result = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }

// This is a trusted server-side plan. Enterprise caps intentionally live outside
// guided searchContext, whose saved-recipe validator correctly enforces its 50-row UI limit.
// The runtime must pass job.maxItems to the runner, and retain researchContext in receipts.
function buildCollectionPlan(input) {
  const program = validateResearchProgram(input);
  const groups = program.sourceGroups.filter((group) => group.enabled);
  if (!groups.length) fail('sourceGroups', 'Enable at least one source group before collecting.');
  const drafts = [];
  for (const group of groups) {
    const queries = group.sourceId === 'linkedin-search' ? (group.targets.length ? group.targets : [program.query]) : null;
    const slices = queries ? queries.map((query) => ({ targets: [], query })) : split(group.targets, 20).map((targets) => ({ targets, query: program.query }));
    slices.forEach((slice, index) => drafts.push({ group, targets: slice.targets, query: slice.query, groupJobIndex: index + 1, weight: slice.targets.length || 1 }));
  }
  if (!drafts.length) fail('sourceGroups', 'No collection jobs could be planned.');
  const platformWeights = {};
  for (const draft of drafts) platformWeights[draft.group.platform] = (platformWeights[draft.group.platform] || 0) + draft.weight;
  const warnings = [];
  const expanded = [];
  for (const draft of drafts) {
    const group = draft.group;
    const options = { ...group.options };
    // A research window is authoritative. Provider limitations are stated below;
    // every platform is also filtered after normalization by prepareResearchEvidence.
    if (program.window.startDate) {
      options.startDate = program.window.startDate;
      if (group.sourceId === 'linkedin-profile') options.postedLimit = 'any';
      if (group.sourceId === 'reddit' && options.includeComments) options.commentStartDate = program.window.startDate;
    }
    if (group.sourceId === 'x' && program.window.endDate) options.endDate = program.window.endDate;
    if (group.sourceId === 'reddit') options.subreddits = draft.targets;
    if (group.sourceId === 'x') options.handles = draft.targets;
    if (group.sourceId === 'linkedin-profile') options.urls = draft.targets;
    const seed = buildSearchRecipes({ query: draft.query, platformIds: [group.sourceId], maxItems: 50, maxTotalChargeUsd: 0.01, sourceOptions: { [group.sourceId]: options } }).recipes[0];
    const allocation = Math.max(1, Math.ceil(program.targetPerPlatform * OVERFETCH_FACTOR * draft.weight / platformWeights[group.platform]));
    if (group.sourceId === 'linkedin-profile') {
      // Each account has its own Actor cap. Overfetch ahead of the client author cap,
      // without requesting thousands of posts from a single author that cannot be kept.
      const postsPerAccount = Math.max(1, Math.min(Math.ceil(allocation / draft.targets.length), Math.ceil(program.perAuthorCap * OVERFETCH_FACTOR), 1000));
      const multiplier = 1 + (seed.input.scrapeComments ? seed.input.maxComments : 0) + (seed.input.scrapeReactions ? seed.input.maxReactions : 0);
      const rowsPerAccount = postsPerAccount * multiplier;
      if (rowsPerAccount > MAX_JOB_PROVIDER_ROWS) fail('sourceGroups.options', 'One LinkedIn account would exceed 10,000 provider rows. Reduce author, comment, or reaction limits.');
      const accountsPerJob = Math.min(20, Math.floor(MAX_JOB_PROVIDER_ROWS / rowsPerAccount));
      split(draft.targets, accountsPerJob).forEach((targets, index) => {
        expanded.push({ ...draft, options: { ...options, urls: targets }, targets, splitIndex: index, seed, plannedPosts: postsPerAccount * targets.length, plannedProviderRows: postsPerAccount * targets.length * multiplier, postsPerAccount });
      });
    } else {
      const desiredRows = group.sourceId === 'reddit' ? Math.max(10, allocation) : allocation;
      // A repeated identical query is not pagination. Keep one bounded request and
      // disclose reduced overfetch instead of charging twice for overlapping rows.
      const requestedRows = Math.min(MAX_JOB_PROVIDER_ROWS, desiredRows);
      if (desiredRows > requestedRows) warnings.push(`${group.name}: overfetch is capped at ${MAX_JOB_PROVIDER_ROWS} provider rows for this query.`);
      expanded.push({ ...draft, options, seed, plannedPosts: requestedRows, plannedProviderRows: requestedRows });
    }
  }
  const requestedBudgetCents = Math.floor((program.budgets.collectionUsd + Number.EPSILON) * 100);
  if (requestedBudgetCents < expanded.length) fail('budgets.collectionUsd', `This source roster needs ${expanded.length} Actor jobs. Set a collection budget of at least $${(expanded.length / 100).toFixed(2)} ($0.01 per job).`);
  if (expanded.reduce((sum, job) => sum + job.plannedProviderRows, 0) > MAX_PLANNED_PROVIDER_ROWS) fail('sourceGroups.options', 'This plan exceeds 100,000 provider rows. Reduce target, comment, or reaction limits.');
  const baseCents = Math.floor(requestedBudgetCents / expanded.length); const remainderCents = requestedBudgetCents % expanded.length;
  const jobs = expanded.map((draft, index) => {
    const { group } = draft;
    const seed = buildSearchRecipes({ query: draft.query, platformIds: [group.sourceId], maxItems: 50, maxTotalChargeUsd: 0.01, sourceOptions: { [group.sourceId]: draft.options } }).recipes[0];
    const input = { ...seed.input };
    if (group.sourceId === 'linkedin-profile') input.maxPosts = draft.postsPerAccount;
    else if (group.sourceId === 'linkedin-search') input.limitPerSource = draft.plannedPosts;
    else { input.maxItems = draft.plannedProviderRows; if (group.sourceId === 'reddit') input.maxPostCount = draft.plannedPosts; }
    if (group.sourceId === 'x' && draft.targets.length > 1) {
      // One search term per author avoids combining a large roster into one OR query.
      input.searchTerms = draft.targets.flatMap((handle) => buildSearchRecipes({ query: draft.query, platformIds: ['x'], maxItems: 50, maxTotalChargeUsd: 0.01, sourceOptions: { x: { ...draft.options, handles: [handle] } } }).recipes[0].input.searchTerms);
    }
    if (group.sourceId === 'reddit' && !draft.query) {
      input.startUrls = draft.targets.map((name) => ({ url: `https://www.reddit.com/r/${name}/new/` }));
      input.searches = [];
      input.searchPosts = false;
    }
    const budgetUsd = Math.min(10000, baseCents + (index < remainderCents ? 1 : 0)) / 100;
    const id = `collection-${hash(`${program.id}:${group.id}:${index}:${JSON.stringify(input)}:${budgetUsd}`)}`;
    const postFilter = { ...program.window, perAuthorCap: program.perAuthorCap, targetPerPlatform: program.targetPerPlatform, maxEvidenceItems: program.maxEvidenceItems, includeUndated: program.includeUndated };
    const researchContext = { programId: program.id, sourceGroupId: group.id, sourceId: group.sourceId, query: draft.query, targets: draft.targets, plannedPosts: draft.plannedPosts, plannedProviderRows: draft.plannedProviderRows, postFilter, sourceOptions: seed.searchContext.sourceOptions, dateSemantics: group.sourceId === 'x' ? seed.searchContext.dateSemantics : `${seed.searchContext.dateSemantics} The research program also applies its inclusive UTC start and end dates after collection.`, warnings: seed.searchContext.warnings.filter((warning) => !/50-post allowance|Up to .*posts and .*engagement rows/.test(warning)) };
    const { searchContext: ignored, ...baseRecipe } = seed;
    const recipe = { ...baseRecipe, name: `${program.name} · ${group.name} · ${index + 1}`, input, runOptions: { maxTotalChargeUsd: budgetUsd, timeoutSecs: group.sourceId === 'x' ? 1200 : 3600 }, researchContext };
    return { id, sourceGroupId: group.id, sourceId: group.sourceId, platform: group.platform, targets: draft.targets, query: draft.query, recipe, maxItems: draft.plannedProviderRows, plannedPosts: draft.plannedPosts, plannedProviderRows: draft.plannedProviderRows, budgetUsd, postFilter };
  });
  const platforms = {};
  for (const job of jobs) {
    platforms[job.platform] ||= { jobCount: 0, targetCount: 0, retainedTarget: program.targetPerPlatform, plannedPosts: 0, plannedProviderRows: 0, budgetUsd: 0 };
    const p = platforms[job.platform]; p.jobCount++; p.targetCount += job.targets.length; p.plannedPosts += job.plannedPosts; p.plannedProviderRows += job.plannedProviderRows; p.budgetUsd = Math.round((p.budgetUsd + job.budgetUsd) * 100) / 100;
  }
  const totalBudgetUsd = Math.round(jobs.reduce((sum, job) => sum + job.budgetUsd, 0) * 100) / 100;
  if (totalBudgetUsd < program.budgets.collectionUsd) warnings.push('Individual Actor budgets are capped at $100; part of the program budget is unallocated.');
  if (program.window.endDate && groups.some((g) => g.sourceId !== 'x')) warnings.push('Reddit and LinkedIn do not support the program’s end date in the Actor query. The end date is enforced after retrieval, so newer excluded rows can consume the collection allowance.');
  if (Object.keys(platforms).length * program.targetPerPlatform > program.maxEvidenceItems) warnings.push(`The combined platform targets exceed the ${program.maxEvidenceItems}-item retained evidence cap; newest retained evidence is kept first.`);
  for (const [p, summary] of Object.entries(platforms)) if (p === 'linkedin' && groups.filter((g) => g.platform === p).every((g) => g.sourceId === 'linkedin-profile') && summary.targetCount * program.perAuthorCap < program.targetPerPlatform) warnings.push(`LinkedIn’s ${summary.targetCount} accounts can retain at most ${summary.targetCount * program.perAuthorCap} posts under the per-author cap, below the requested ${program.targetPerPlatform}.`);
  warnings.push('Planned counts are maximum requests, not guaranteed results. Spend caps, source activity, unavailable accounts, duplicate posts, and author limits can reduce retained evidence.');
  return { programId: program.id, jobs, receipt: { jobCount: jobs.length, requestedBudgetUsd: program.budgets.collectionUsd, totalBudgetUsd, totalPlannedPosts: jobs.reduce((sum, job) => sum + job.plannedPosts, 0), totalPlannedProviderRows: jobs.reduce((sum, job) => sum + job.plannedProviderRows, 0), retainedEvidenceCap: program.maxEvidenceItems, platforms, warnings } };
}
module.exports = { buildCollectionPlan, MAX_JOB_PROVIDER_ROWS, MAX_PLANNED_PROVIDER_ROWS, OVERFETCH_FACTOR };
