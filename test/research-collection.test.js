import { describe, expect, it } from 'vitest';
import collection from '../src/shared/research-collection.js';
import recipeTools from '../src/shared/recipe.js';
const { buildCollectionPlan } = collection;
const program = (extra = {}) => ({ id: 'program-a', name: 'Weekly research', targetPerPlatform: 3000, sourceGroups: [{ id: 'x-accounts', platform: 'x', targets: ['account1', 'account2'] }], budgets: { collectionUsd: 5, aiUsd: 5 }, ...extra });

describe('bounded enterprise collection plans', () => {
  it('plans complete large rosters and explicit provider row caps beyond guided search limits', () => {
    const result = buildCollectionPlan(program({ sourceGroups: [{ id: 'x', platform: 'x', targets: Array.from({ length: 382 }, (_, i) => `account${i}`) }, { id: 'li', platform: 'linkedin-profile', targets: Array.from({ length: 515 }, (_, i) => `https://linkedin.com/in/profile-${i}`) }, { id: 'rd', platform: 'reddit', targets: Array.from({ length: 18 }, (_, i) => `community${i}`) }] }));
    expect(result.jobs).toHaveLength(47);
    expect(result.receipt.platforms.x.targetCount).toBe(382);
    expect(result.receipt.platforms.linkedin.targetCount).toBe(515);
    expect(result.receipt.platforms.reddit.targetCount).toBe(18);
    expect(result.jobs.every((j) => j.targets.length <= 20 && j.maxItems <= 10000 && j.budgetUsd >= 0.01)).toBe(true);
    expect(result.receipt.totalBudgetUsd).toBe(5);
    expect(result.receipt.platforms.x.plannedPosts).toBeGreaterThanOrEqual(4500);
    expect(result.receipt.platforms.linkedin.plannedPosts).toBeGreaterThanOrEqual(4500);
    expect(result.jobs.find((j) => j.sourceId === 'linkedin-profile').recipe.input.maxPosts).toBe(9);
  });
  it('keeps Actor inputs validated and enterprise retrieval caps separate from guided searchContext', () => {
    const plan = buildCollectionPlan(program()); const job = plan.jobs[0];
    expect(job.maxItems).toBe(4500); expect(job.recipe.input.maxItems).toBe(4500);
    expect(job.recipe).not.toHaveProperty('searchContext'); expect(job.recipe.researchContext.plannedProviderRows).toBe(4500);
    expect(() => recipeTools.validateRecipe(job.recipe)).not.toThrow();
    expect(job.recipe.input.searchTerms).toHaveLength(2);
    expect(job.recipe.input.searchTerms[0]).toContain('from:account1');
    expect(job.recipe.input.searchTerms[1]).toContain('from:account2');
    expect(plan).toEqual(buildCollectionPlan(program()));
  });
  it('splits the budget to cents and refuses a roster with insufficient per-job budget', () => {
    const groups = [{ platform: 'x', targets: Array.from({ length: 41 }, (_, i) => `account${i}`) }];
    const plan = buildCollectionPlan(program({ sourceGroups: groups, budgets: { collectionUsd: 0.1, aiUsd: 1 } }));
    expect(plan.jobs.map((j) => j.budgetUsd)).toEqual([0.04, 0.03, 0.03]);
    expect(() => buildCollectionPlan(program({ sourceGroups: groups, budgets: { collectionUsd: 0.02, aiUsd: 1 } }))).toThrow(/at least \$0.03/);
  });
  it('preserves supported comments and reaction knobs with correct separate-row retrieval accounting', () => {
    const plan = buildCollectionPlan(program({ targetPerPlatform: 100, sourceGroups: [{ platform: 'linkedin-profile', targets: ['https://linkedin.com/in/a', 'https://linkedin.com/in/b'], options: { includeComments: true, maxComments: 2, includeReactions: true, maxReactions: 3, commentsPostedLimit: 'week' } }] }));
    const job = plan.jobs[0];
    expect(job.recipe.input).toMatchObject({ maxPosts: 15, scrapeComments: true, maxComments: 2, scrapeReactions: true, maxReactions: 3, commentsPostedLimit: 'week' });
    expect(job).toMatchObject({ plannedPosts: 30, plannedProviderRows: 180, maxItems: 180 });
    expect(plan.receipt.warnings.join(' ')).toMatch(/at most 20 posts/);
  });
  it('further splits LinkedIn targets when comments would exceed one-job provider row limits', () => {
    const plan = buildCollectionPlan(program({ sourceGroups: [{ platform: 'linkedin-profile', targets: Array.from({ length: 20 }, (_, i) => `https://linkedin.com/in/p${i}`), options: { includeComments: true, maxComments: 100, includeReactions: true, maxReactions: 100 } }] }));
    expect(plan.jobs).toHaveLength(7); expect(plan.jobs.every((j) => j.maxItems <= 10000)).toBe(true);
    expect(plan.jobs.flatMap((j) => j.targets)).toHaveLength(20);
    expect(plan.receipt.totalPlannedProviderRows).toBe(60300);
  });
  it('rejects a plan over the global provider row cap before any paid work', () => {
    expect(() => buildCollectionPlan(program({ sourceGroups: [{ platform: 'linkedin-profile', targets: Array.from({ length: 40 }, (_, i) => `https://linkedin.com/in/p${i}`), options: { includeComments: true, maxComments: 100, includeReactions: true, maxReactions: 100 } }] }))).toThrow(/100,000/);
  });
  it('applies program dates to supported provider inputs and carries the same final filter for all sources', () => {
    const window = { startDate: '2026-09-01', endDate: '2026-09-07' };
    const plan = buildCollectionPlan(program({ window, sourceGroups: [{ platform: 'x', targets: ['account'], options: { replies: 'exclude', includeRetweets: false } }, { platform: 'reddit', targets: ['marketing'], options: { includeComments: true, maxComments: 3 } }, { platform: 'linkedin-profile', targets: ['https://linkedin.com/in/a'], options: { postedLimit: 'week' } }] }));
    const [x, rd, li] = plan.jobs;
    expect(x.recipe.input.searchTerms[0]).toContain('since:2026-09-01 until:2026-09-08 -filter:replies -filter:nativeretweets');
    expect(rd.recipe.input).toMatchObject({ postDateLimit: '2026-09-01', commentDateLimit: '2026-09-01', skipComments: false, maxComments: 3 });
    expect(li.recipe.input).toMatchObject({ postedLimit: 'any', postedLimitDate: '2026-09-01' });
    expect(plan.jobs.every((j) => j.postFilter.startDate === window.startDate && j.postFilter.endDate === window.endDate)).toBe(true);
    expect(plan.receipt.warnings.join(' ')).toMatch(/enforced after retrieval/);
  });
  it('collects Reddit community listings when no keyword is provided', () => {
    const plan = buildCollectionPlan(program({ sourceGroups: [{ platform: 'reddit', targets: ['marketing', 'seo'], options: { includeNSFW: false } }] }));
    expect(plan.jobs[0].recipe.input).toMatchObject({ startUrls: [{ url: 'https://www.reddit.com/r/marketing/new/' }, { url: 'https://www.reddit.com/r/seo/new/' }], searches: [], searchPosts: false, maxItems: 4500 });
  });
  it('treats LinkedIn keyword group targets as separate terms, never profile URLs', () => {
    const plan = buildCollectionPlan(program({ sourceGroups: [{ sourceId: 'linkedin-search', targets: ['AI search', 'marketing analytics'], options: { includeComments: true, maxComments: 2 } }] }));
    expect(plan.jobs).toHaveLength(2); expect(plan.jobs.map((j) => j.query)).toEqual(['AI search', 'marketing analytics']);
    expect(new URL(plan.jobs[0].recipe.input.urls[0]).searchParams.get('keywords')).toBe('AI search');
    expect(plan.jobs[0].recipe.input).toMatchObject({ limitPerSource: 2250, numComments: 2 });
  });
  it('rejects unsupported options and impossible plans, and excludes disabled groups', () => {
    expect(() => buildCollectionPlan(program({ sourceGroups: [{ platform: 'x', targets: ['a'], options: { comments: true } }] }))).toThrow(/does not support/);
    const large = buildCollectionPlan(program({ targetPerPlatform: 10000 }));
    expect(large.jobs).toHaveLength(1); expect(large.jobs[0].maxItems).toBe(10000);
    expect(large.receipt.warnings.join(' ')).toMatch(/overfetch is capped/);
    expect(() => buildCollectionPlan(program({ sourceGroups: [{ platform: 'x', targets: [], enabled: false }] }))).toThrow(/Enable/);
    const plan = buildCollectionPlan(program({ sourceGroups: [{ platform: 'x', targets: ['a'] }, { platform: 'reddit', enabled: false, targets: [] }] }));
    expect(plan.jobs).toHaveLength(1);
  });
});
