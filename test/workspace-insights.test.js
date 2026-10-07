import { describe, expect, it } from 'vitest';
import { buildCoverage, buildSignals, buildTopics, coverageChecks } from '../src/shared/dataset-insights.js';
import { activitySummary, buildActivity, dayLabel, filterActivity, formatDuration } from '../src/shared/activity-feed.js';

const items = [
  { id: '1', platform: 'reddit', type: 'post', author: 'ana', text: 'Pricing pages are confusing and pricing pages hide the real cost.', url: 'https://r/1', publishedAt: '2026-10-01T10:00:00Z', metrics: { likes: 10, comments: 5, shares: 0 } },
  { id: '2', platform: 'x', type: 'post', author: { name: 'Ben' }, text: 'Onboarding takes too long. Pricing pages again.', url: 'https://x/2', publishedAt: '2026-10-03T10:00:00Z', metrics: { likes: 50, comments: 1, shares: 4 } },
  { id: '3', platform: 'reddit', type: 'comment', author: 'ana', text: 'The onboarding flow is slow for new teams.', publishedAt: '', metrics: {} },
];

describe('dataset signals', () => {
  it('filters by platform and text, and sorts by engagement or date', () => {
    expect(buildSignals(items).rows.map(row => row.item.id)).toEqual(['2', '1', '3']);
    expect(buildSignals(items, { sort: 'newest' }).rows.map(row => row.item.id)).toEqual(['2', '1', '3']);
    expect(buildSignals(items, { sort: 'oldest' }).rows.map(row => row.item.id)).toEqual(['1', '2', '3']);
    expect(buildSignals(items, { platform: 'reddit', query: 'onboarding' }).rows.map(row => row.item.id)).toEqual(['3']);
    expect(buildSignals(items, { query: 'ben' }).rows.map(row => row.item.id)).toEqual(['2']);
    expect(buildSignals(items).facets.platforms).toEqual([{ value: 'reddit', total: 2 }, { value: 'x', total: 1 }]);
  });
});

describe('dataset topics', () => {
  it('ranks phrases by how many rows mention them, ignoring filler words', () => {
    const { topics } = buildTopics(items, { mode: 'phrases' });
    expect(topics[0]).toMatchObject({ term: 'pricing pages', total: 2 });
    expect(topics[0].share).toBeCloseTo(2 / 3);
    const words = buildTopics(items, { mode: 'words' }).topics.map(topic => topic.term);
    expect(words.slice(0, 2)).toEqual(['onboarding', 'pages']);
    expect(words).not.toContain('the');
    const filler = buildTopics([{ text: 'Has anyone else seen this with their team?' }, { text: 'Anyone else seen this with their team?' }], { mode: 'phrases' }).topics.map(topic => topic.term);
    expect(filler).not.toContain('seen team');
    expect(filler).not.toContain('anyone else');
  });
});

describe('dataset coverage', () => {
  it('reports dates, links, authors and plain-language checks', () => {
    const coverage = buildCoverage(items, Date.parse('2026-10-06T00:00:00Z'));
    expect(coverage).toMatchObject({ total: 3, authors: 2, dated: 2, withUrl: 2, topAuthor: 'ana', newestAgeDays: 2 });
    const checks = coverageChecks(coverage).map(check => check.tone + ':' + check.text);
    expect(checks[0]).toMatch(/^warning:Only 3 rows/);
    expect(checks.some(text => /ana wrote 67%/.test(text))).toBe(true);
    expect(coverageChecks(buildCoverage([]))).toEqual([]);
  });
});

describe('activity timeline', () => {
  const state = {
    recipes: [{ id: 'r1', name: 'Pricing scraper' }],
    datasets: [{ id: 'd1', name: 'Pricing data' }],
    runs: [{ id: 'run1', recipeId: 'r1', datasetId: 'd1', status: 'succeeded', itemCount: 120, startedAt: '2026-10-05T10:00:00Z', finishedAt: '2026-10-05T10:02:05Z' }],
    jobs: [{ id: 'run1', kind: 'run', status: 'succeeded' }, { id: 'job2', kind: 'chat', title: 'Ask findings', status: 'running', startedAt: '2026-10-06T09:00:00Z', cancellable: true }],
    analyses: [{ id: 'a1', datasetId: 'd1', kind: 'report', status: 'failed', error: 'Budget reached', startedAt: '2026-10-04T08:00:00Z' }],
    contentStudio: { programs: [{ id: 'p1', name: 'AI search pulse' }], researchRuns: [{ id: 'rr1', programId: 'p1', status: 'awaiting-review', themes: [{ id: 't' }, { id: 'u' }], createdAt: '2026-10-06T08:00:00Z', costUsd: 0.4 }], contentRuns: [{ id: 'c1', title: 'Launch pack', status: 'succeeded', jobs: [{ status: 'succeeded' }, { status: 'failed' }], createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:03:00Z', costUsd: 1.2 }] },
  };
  it('merges every kind of work into one newest-first timeline without duplicates', () => {
    const entries = buildActivity(state);
    expect(entries.map(entry => entry.id)).toEqual(['job2', 'rr1', 'c1', 'run1', 'a1']);
    expect(entries.find(entry => entry.id === 'run1')).toMatchObject({ kind: 'collection', title: 'Pricing scraper', state: 'done', durationMs: 125000, datasetId: 'd1', recipeId: 'r1' });
    expect(entries.find(entry => entry.id === 'rr1')).toMatchObject({ kind: 'research', title: 'AI search pulse', state: 'review', subtitle: '2 trends waiting for your OK' });
    expect(entries.find(entry => entry.id === 'c1')).toMatchObject({ subtitle: '1 of 2 deliverables', durationMs: 180000 });
    expect(entries.find(entry => entry.id === 'a1')).toMatchObject({ kind: 'analysis', state: 'attention', error: 'Budget reached' });
  });
  it('filters, summarizes, and labels days', () => {
    const entries = buildActivity(state);
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(filterActivity(entries, { kind: 'research' }).map(entry => entry.id)).toEqual(['rr1']);
    expect(filterActivity(entries, { query: 'budget' }).map(entry => entry.id)).toEqual(['a1']);
    expect(filterActivity(entries, { sinceDays: 1, now }).map(entry => entry.id)).toEqual(['job2', 'rr1', 'c1']);
    expect(activitySummary(entries, now)).toMatchObject({ active: 1, review: 1, attention: 1, doneThisWeek: 2, rowsThisWeek: 120 });
    expect(activitySummary(entries, now).spendThisWeek).toBeCloseTo(1.6);
    expect(formatDuration(125000)).toBe('2m 05s');
    expect(dayLabel('2026-10-06T09:00:00', new Date('2026-10-06T12:00:00'))).toBe('Today');
    expect(dayLabel('2026-10-05T09:00:00', new Date('2026-10-06T12:00:00'))).toBe('Yesterday');
  });
});
