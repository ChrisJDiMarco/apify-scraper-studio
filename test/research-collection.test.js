import { describe, expect, it } from 'vitest';
import collection from '../src/shared/research-collection.js';
import recipeTools from '../src/shared/recipe.js';
const { buildCollectionPlan, ACTOR_PRICING } = collection;
const now = new Date('2026-10-07T12:00:00Z');
const program = (extra = {}) => ({ id: 'program-a', name: 'Weekly research', targetPerPlatform: 3000, sourceGroups: [{ id: 'x-accounts', platform: 'x', targets: ['account1', 'account2'] }], budgets: { collectionUsd: 5, aiUsd: 5 }, ...extra });
const plan = (extra, options = { now }) => buildCollectionPlan(program(extra), options);

describe('n8n Golden Thread collection plans', () => {
  it('plans the full Semrush roster with n8n inputs, concurrent lanes and worst-case budgets', () => {
    const result = plan({ budgets: { collectionUsd: 60, aiUsd: 5 }, sourceGroups: [{ id: 'x', platform: 'x', targets: Array.from({ length: 382 }, (_, i) => `account${i}`) }, { id: 'li', platform: 'linkedin-profile', targets: Array.from({ length: 515 }, (_, i) => `https://linkedin.com/in/profile-${i}`) }, { id: 'rd', platform: 'reddit', targets: Array.from({ length: 18 }, (_, i) => `community${i}`) }] });
    expect(result.receipt.platforms.x).toMatchObject({ jobCount: 77, targetCount: 382 });
    expect(result.receipt.platforms.linkedin).toMatchObject({ jobCount: 6, targetCount: 515, plannedPosts: 7725 });
    // Reddit runs in parallel groups of 6 subreddits (3 × min(4,500, 6 × 300) posts), unlike n8n's single run.
    expect(result.receipt.platforms.reddit).toMatchObject({ jobCount: 3, targetCount: 18, plannedPosts: 5400 });
    expect(result.receipt.worstCaseUsd).toBeCloseTo(50.86, 1);
    expect(result.receipt.totalBudgetUsd).toBeLessThanOrEqual(60);
    expect(result.jobs.every((job) => job.budgetUsd >= job.worstCaseUsd)).toBe(true);
    for (const job of result.jobs) expect(() => recipeTools.validateRecipe(job.recipe)).not.toThrow();
  });
  it('builds X terms exactly like n8n: from:<handle> since:<start>, Latest, generous per-handle ceiling', () => {
    const result = plan({ window: { startDate: '2026-09-30' } }); const job = result.jobs[0];
    expect(job.recipe.input).toEqual({ searchTerms: ['from:account1 since:2026-09-30', 'from:account2 since:2026-09-30'], sort: 'Latest', maxItems: 100, includeSearchTerms: true });
    expect(job.recipe.runOptions).toEqual({ maxTotalChargeUsd: 5, timeoutSecs: 1200 });
    expect(job.abortAfterSecs).toBe(1500);
    expect(job.worstCaseUsd).toBeCloseTo(2 * ACTOR_PRICING['apidojo/twitter-scraper-lite'].perQuery + 100 * 0.0004, 1);
  });
  it('never lets the research focus filter account or community collection unless asked', () => {
    const focused = plan({ query: 'SEO trending topicsso', sourceGroups: [{ platform: 'x', targets: ['aleyda'] }, { platform: 'reddit', targets: ['seo'] }] });
    const [x, reddit] = focused.jobs;
    expect(x.recipe.input.searchTerms).toEqual(['from:aleyda since:2026-09-30']);
    expect(reddit.recipe.input.startUrls).toEqual([{ url: 'https://www.reddit.com/r/seo/new/' }]);
    expect(focused.receipt.warnings.join(' ')).toMatch(/guides the AI analysis only/);
    const filtered = plan({ query: 'AI Overviews', topicFiltersTargets: true, sourceGroups: [{ platform: 'x', targets: ['aleyda'] }, { platform: 'reddit', targets: ['seo'] }] });
    expect(filtered.jobs[0].recipe.input.searchTerms[0]).toBe('(AI Overviews) from:aleyda since:2026-09-30');
    expect(filtered.jobs[1].recipe.input.searches[0]).toBe('(AI Overviews) AND (subreddit:seo)');
  });
  it('defaults to the n8n seven-day window when no start date is saved', () => {
    const result = plan();
    expect(result.window).toMatchObject({ startDate: '2026-09-30', endDate: '', resolvedFrom: 'lookback' });
    expect(result.receipt.warnings.join(' ')).toMatch(/last 7 days \(from 2026-09-30\)/);
    expect(plan({ lookbackDays: 14 }).window.startDate).toBe('2026-09-23');
  });
  it('builds LinkedIn and Reddit inputs like the n8n Sources nodes, with a longer Reddit scroll', () => {
    const result = plan({ window: { startDate: '2026-09-01', endDate: '2026-09-07' }, sourceGroups: [{ platform: 'linkedin-profile', targets: ['https://www.linkedin.com/in/a?trk=x'] }, { platform: 'reddit', targets: ['marketing', 'seo'] }] });
    const [li, rd] = result.jobs;
    expect(li.recipe.input).toEqual({ targetUrls: ['https://www.linkedin.com/in/a/'], maxPosts: 15, postedLimitDate: '2026-09-01T00:00:00.000Z', scrapeReactions: false, scrapeComments: false });
    expect(li.recipe.runOptions.timeoutSecs).toBe(5400); expect(li.abortAfterSecs).toBe(5700);
    // n8n scrolled 90s per listing, which reached only 3–4 days back in busy subreddits.
    expect(rd.recipe.input).toEqual({ maxItems: 4500, maxPostCount: 300, maxComments: 75, skipComments: true, scrollTimeout: 300, navigationTimeout: 60, includeMediaLinks: true, includeNSFW: false, skipCommunity: true, skipUserPosts: true, proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }, startUrls: [{ url: 'https://www.reddit.com/r/marketing/new/' }, { url: 'https://www.reddit.com/r/seo/new/' }], postDateLimit: '2026-09-01T00:00:00.000Z', commentDateLimit: '2026-09-01T00:00:00.000Z', ignoreStartUrls: false, debugMode: false });
    expect(rd.recipe.runOptions.timeoutSecs).toBe(7200); expect(rd.abortAfterSecs).toBe(7500);
    // Two /new/ listings can return at most 2 × 300 posts, so the cost ceiling is far below maxItems.
    expect(rd).toMatchObject({ plannedPosts: 600, maxItems: 4500 }); expect(rd.worstCaseUsd).toBeCloseTo(2.42, 2);
    expect(result.jobs.every((j) => j.postFilter.startDate === '2026-09-01' && j.postFilter.endDate === '2026-09-07')).toBe(true);
    expect(result.receipt.warnings.join(' ')).toMatch(/enforced after retrieval/);
  });
  it('splits subreddits into parallel groups that each keep the platform ceiling', () => {
    const subs = Array.from({ length: 14 }, (_, i) => `community${i}`);
    const result = plan({ targetPerPlatform: 1000, sourceGroups: [{ platform: 'reddit', targets: subs }] });
    expect(result.jobs.map((job) => job.recipe.input.startUrls.length)).toEqual([6, 6, 2]);
    expect(result.jobs.flatMap((job) => job.targets)).toEqual(subs);
    expect(result.jobs.every((job) => job.recipe.input.maxItems === 1500 && job.lane === 'reddit')).toBe(true);
    expect(result.jobs.map((job) => job.plannedPosts)).toEqual([1500, 1500, 600]);
    expect(plan({ sourceGroups: [{ platform: 'reddit', targets: subs }], collection: { redditSubsPerJob: 20 } }).jobs).toHaveLength(1);
    // Topic-filtered search stays one query across every community.
    expect(plan({ query: 'AI Overviews', topicFiltersTargets: true, sourceGroups: [{ platform: 'reddit', targets: subs }] }).jobs).toHaveLength(1);
  });
  it('keeps supported X filters and Reddit comment collection, with comments counted against maxItems', () => {
    const result = plan({ window: { startDate: '2026-09-01', endDate: '2026-09-07' }, sourceGroups: [{ platform: 'x', targets: ['account'], options: { replies: 'exclude', includeRetweets: false } }, { platform: 'reddit', targets: ['marketing'], options: { includeComments: true, maxComments: 3 } }] });
    expect(result.jobs[0].recipe.input.searchTerms[0]).toBe('from:account since:2026-09-01 until:2026-09-08 -filter:replies -filter:nativeretweets');
    expect(result.jobs[1].recipe.input).toMatchObject({ skipComments: false, maxComments: 3, maxItems: 10000 });
    expect(result.jobs[1]).toMatchObject({ plannedPosts: 300 }); expect(result.jobs[1].worstCaseUsd).toBeCloseTo(0.02 + 300 * 4 * 0.004, 2);
  });
  it('splits LinkedIn jobs to stay under provider row limits when comments and reactions are on', () => {
    const result = plan({ sourceGroups: [{ platform: 'linkedin-profile', targets: Array.from({ length: 20 }, (_, i) => `https://linkedin.com/in/p${i}`), options: { includeComments: true, maxComments: 100, includeReactions: true, maxReactions: 100 } }] });
    expect(result.jobs.every((j) => j.maxItems <= 10000)).toBe(true);
    expect(result.jobs.flatMap((j) => j.targets)).toHaveLength(20);
    expect(() => plan({ sourceGroups: [{ platform: 'linkedin-profile', targets: Array.from({ length: 40 }, (_, i) => `https://linkedin.com/in/p${i}`), options: { includeComments: true, maxComments: 100, includeReactions: true, maxReactions: 100 } }] })).toThrow(/100,000/);
  });
  it('gives every Actor at least its minimum charge and refuses budgets that cannot start them all', () => {
    const groups = [{ platform: 'x', targets: Array.from({ length: 41 }, (_, i) => `account${i}`) }];
    const ok = plan({ sourceGroups: groups, budgets: { collectionUsd: 0.5, aiUsd: 1 } });
    expect(ok.jobs.every((j) => j.budgetUsd >= 0.02)).toBe(true);
    expect(ok.receipt.warnings.join(' ')).toMatch(/below the worst-case Apify cost/);
    expect(() => plan({ sourceGroups: groups, budgets: { collectionUsd: 0.1, aiUsd: 1 } })).toThrow(/at least \$0.18/);
  });
  it('treats LinkedIn keyword group targets as separate terms, never profile URLs', () => {
    const result = plan({ sourceGroups: [{ sourceId: 'linkedin-search', targets: ['AI search', 'marketing analytics'], options: { includeComments: true, maxComments: 2 } }] });
    expect(result.jobs).toHaveLength(2); expect(result.jobs.map((j) => j.query)).toEqual(['AI search', 'marketing analytics']);
    expect(new URL(result.jobs[0].recipe.input.urls[0]).searchParams.get('keywords')).toBe('AI search');
    expect(result.jobs[0].recipe.input).toMatchObject({ limitPerSource: 2250, numComments: 2 });
  });
  it('rejects unsupported options and excludes disabled groups', () => {
    expect(() => plan({ sourceGroups: [{ platform: 'x', targets: ['a'], options: { comments: true } }] })).toThrow(/does not support/);
    expect(() => plan({ sourceGroups: [{ platform: 'x', targets: [], enabled: false }] })).toThrow(/Enable/);
    expect(plan({ sourceGroups: [{ platform: 'x', targets: ['a'] }, { platform: 'reddit', enabled: false, targets: [] }] }).jobs).toHaveLength(1);
    expect(plan()).toEqual(plan());
  });
});
