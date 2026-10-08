import { describe, it, expect } from 'vitest';
import engine from '../src/shared/research-program.js';
const { validateResearchProgram, researchMetrics, engagementScore, prepareResearchEvidence, buildDiscoveryBatches, buildAssignmentBatches, validateCandidates, validateThemes, validateAssignments, applyAssignments, calculateThemeHistory, calculateThemePriority, buildThemeEvidenceSnapshot, validateExactQuotes } = engine;
const program = (extra = {}) => ({ name: 'Search market research', sourceGroups: [{ platform: 'x', targets: ['marketer'] }], ...extra });
const row = (id, extra = {}) => ({ id: `raw-${id}`, externalId: String(id), platform: 'x', type: 'post', author: `author${id}`, text: `Evidence ${id}: useful market feedback`, url: `https://x.com/account/status/${id}`, publishedAt: '2026-09-20T12:00:00Z', raw: { likeCount: 99, replyCount: 9, retweetCount: 9, quoteCount: 9, bookmarkCount: 9, viewCount: 999 }, ...extra });
const prepare = (items, extra = {}) => prepareResearchEvidence({ runId: 'run-a', program: program(extra), items });
const cohort = (count, extra = {}) => prepare(Array.from({ length: count }, (_, i) => row(i + 1)), extra).items;
const candidateOutput = (batch) => ({ candidates: [{ name: 'Search reporting friction', summary: 'A concrete problem evidenced by the supplied posts.', painPoint: 'Workflow/Resource Overload', semanticIntentSignals: ['Reports take too long'], actionability: 'Simplify the reporting workflow.', evidenceIds: batch.evidenceIds.slice(0, 2) }] });
const makeCandidates = (items) => { const batch = buildDiscoveryBatches({ runId: 'run-a', items }).batches[0]; return validateCandidates(candidateOutput(batch), { runId: 'run-a', batch }); };
const themeOutput = (candidates, extra = {}) => ({ themes: [{ name: 'Search reporting friction', description: 'Reports require manual work.', existingThemeId: null, candidateIds: candidates.map((c) => c.id), novelty: 'NEW ANGLE', matchingKeywords: ['reporting'], matchingCriteria: 'A concrete reporting workflow problem.', negativeCriteria: 'Generic promotion.', taxonomyCategory: 'Reporting', ...extra }] });
const assign = (item, themeId = 'theme-a', extra = {}) => ({ itemId: item.id, themeId, confidence: 0.8, reason: 'Describes the reporting problem.', painPoint: 'Workflow/Resource Overload', urgency: 'Strategic Planning', entities: { tools: [], people: [], companies: [] }, ...extra });
const validAssignments = (items, extras = []) => { const batch = buildAssignmentBatches({ runId: 'run-a', items, byPlatform: false, batchSize: 200 }).batches[0]; return validateAssignments({ assignments: items.map((item, i) => assign(item, 'theme-a', extras[i])) }, { runId: 'run-a', batch, themes: [{ id: 'theme-a' }] }); };

describe('saved enterprise research programs', () => {
  it('accepts and deduplicates large source rosters beyond the guided-search limit', () => {
    const p = validateResearchProgram(program({ sourceGroups: [{ platform: 'x', targets: Array.from({ length: 382 }, (_, i) => `author${i}`).concat('@author0') }, { platform: 'linkedin-profile', targets: Array.from({ length: 515 }, (_, i) => `https://www.linkedin.com/in/person-${i}/?trk=test`) }] }));
    expect(p.sourceGroups.map((s) => s.targets.length)).toEqual([382, 515]);
    expect(p.sourceGroups[1]).toMatchObject({ platform: 'linkedin', sourceId: 'linkedin-profile' });
    expect(p.sourceGroups[1].targets[0]).toBe('https://www.linkedin.com/in/person-0');
    expect(p).toMatchObject({ targetPerPlatform: 3000, maxEvidenceItems: 10000, lookbackDays: 7, topicFiltersTargets: false, budgets: { collectionUsd: 10, aiUsd: 25 }, taggingBatchSizes: { x: 50, linkedin: 40, reddit: 50 } });
    expect(p.ai.models).toEqual({ discovery: 'claude-opus-5-5', synthesis: 'claude-opus-5-5', matching: 'claude-opus-5-5', tagging: 'claude-fable-5-1', reports: 'claude-fable-5-1' });
  });
  it('validates dates, enabled targets, budgets and actual booleans', () => {
    expect(() => validateResearchProgram(program({ window: { startDate: '2026-02-30' } }))).toThrow(/valid/);
    expect(() => validateResearchProgram(program({ window: { startDate: '2026-09-20', endDate: '2026-09-19' } }))).toThrow(/end date/);
    expect(() => validateResearchProgram(program({ budgets: { aiUsd: 0 } }))).toThrow(/between/);
    expect(() => validateResearchProgram(program({ includeUndated: 'true' }))).toThrow(/true or false/);
    expect(() => validateResearchProgram(program({ sourceGroups: [{ platform: 'x', targets: [] }] }))).toThrow(/targets/);
    expect(() => validateResearchProgram(program({ maxEvidenceItems: 10001 }))).toThrow(/10000/);
    expect(() => validateResearchProgram(program({ confidenceThreshold: 0.5 }))).toThrow(/0.55/);
  });
  it('rejects credential-bearing, lookalike and wrong platform targets', () => {
    for (const target of ['https://user:pass@linkedin.com/in/a', 'https://linkedin.com.evil.test/in/a', 'https://linkedin.com:443/in/a', 'https://x.com/a/status/1']) {
      const p = target.includes('x.com') ? 'x' : 'linkedin-profile';
      // URL normalizes default HTTPS ports away; nondefault ports are forbidden below.
      if (target.includes(':443')) continue;
      expect(() => validateResearchProgram(program({ sourceGroups: [{ platform: p, targets: [target] }] }))).toThrow();
    }
    expect(() => validateResearchProgram(program({ sourceGroups: [{ platform: 'x', targets: ['ok'], options: { apiKey: 'example-only' } }] }))).toThrow(/credentials/);
    expect(() => validateResearchProgram(program({ sourceGroups: [{ platform: 'linkedin-profile', targets: ['https://linkedin.com:8443/in/a'] }] }))).toThrow();
  });
  it('caps total targets, supports disabled groups and keyword-only LinkedIn', () => {
    expect(() => validateResearchProgram(program({ sourceGroups: Array.from({ length: 3 }, (_, i) => ({ platform: 'x', targets: Array.from({ length: 800 }, (_, j) => `account${i}_${j}`) })) }))).toThrow(/2,000/);
    expect(validateResearchProgram(program({ query: 'Search reporting', sourceGroups: [{ sourceId: 'linkedin-search', targets: [] }, { platform: 'reddit', enabled: false, targets: [] }] })).sourceGroups).toHaveLength(2);
  });
});

describe('evidence preparation and known metrics', () => {
  it('reads raw quotes/bookmarks/ratios and distinguishes missing values from zero', () => {
    const values = researchMetrics({ metrics: { likes: 0, comments: 0, shares: 0, views: 0 }, raw: { likeCount: 0, bookmarkCount: 4, quoteCount: 2, comments: [] } });
    expect(values.metrics).toMatchObject({ likes: 0, comments: null, shares: null, bookmarks: 4, quotes: 2 });
    expect(values.metricStatus).toMatchObject({ likes: 'known', comments: 'invalid', shares: 'missing' });
    expect(researchMetrics({ raw: { upVotes: -3, upVoteRatio: 0.75 } }).metrics).toMatchObject({ upvotes: -3, upvoteRatio: 0.75 });
    expect(researchMetrics({ raw: { upvoteRatio: 1.5, likes: 'not a number' } }).metricStatus).toMatchObject({ upvoteRatio: 'invalid', likes: 'invalid' });
  });
  it('computes each platform formula with bounded logarithms', () => {
    expect(engagementScore('x', { likes: 9, shares: 9, comments: 9, quotes: 9, bookmarks: 9, views: 9 })).toMatchObject({ value: 87, complete: true });
    expect(engagementScore('linkedin', { likes: 9, comments: 9 })).toMatchObject({ value: 35, complete: true });
    expect(engagementScore('reddit', { upvotes: 9, comments: 9, upvoteRatio: 0.8 })).toMatchObject({ value: 44, complete: true });
    expect(engagementScore('reddit', { upvotes: -3, comments: 0, upvoteRatio: 0.5 }).value).toBe(0);
    expect(engagementScore('x', {}).value).toBeNull();
  });
  it('preserves Reddit titles and comment identities sharing their parent URL', () => {
    const result = prepare([
      row(1, { platform: 'reddit', text: '', raw: { title: 'How do I explain lost traffic?', upVotes: 30, numberOfComments: 10 }, url: 'https://reddit.com/r/seo/comments/abc' }),
      row(2, { platform: 'reddit', type: 'comment', text: 'First independent reply', url: 'https://reddit.com/r/seo/comments/abc' }),
      row(3, { platform: 'reddit', type: 'comment', text: 'Another independent reply', url: 'https://reddit.com/r/seo/comments/abc' }),
    ]);
    expect(result.items).toHaveLength(3);
    expect(result.items.find((i) => i.externalId === '1').text).toBe('How do I explain lost traffic?');
    expect(new Set(result.items.map((i) => i.id)).size).toBe(3);
  });
  it('deduplicates like n8n: URL first, then the first 100 characters (whitespace removed) plus author', () => {
    const prefix = 'a'.repeat(100);
    const result = prepare([row(1, { text: `${prefix} different conclusion`, author: 'same' }), row(2, { text: `${prefix} another conclusion`, author: 'same' }), row(3, { text: `${prefix} another conclusion`, author: 'other' }), row(4, { text: 'A separate post', url: 'https://x.com/account/status/1' })]);
    expect(result.items.map((i) => i.externalId).sort()).toEqual(['1', '3']); expect(result.receipt.dropped.duplicate).toBe(2);
  });
  it('enforces inclusive UTC date boundaries and explicitly drops unknown dates', () => {
    const result = prepare([row(1, { publishedAt: '2026-09-19T23:59:59Z' }), row(2, { publishedAt: '2026-09-20T00:00:00Z' }), row(3, { publishedAt: '2026-09-21T23:59:59Z' }), row(4, { publishedAt: '2026-09-22T00:00:00Z' }), row(5, { publishedAt: '' })], { window: { startDate: '2026-09-20', endDate: '2026-09-21' } });
    expect(result.items.map((i) => i.externalId).sort()).toEqual(['2', '3']);
    expect(result.receipt.dropped).toMatchObject({ outsideWindow: 2, undated: 1 });
  });
  it('keeps missing authors separate and respects newest-first author/platform/total caps', () => {
    const result = prepare([row(1, { author: 'same', publishedAt: '2026-09-19' }), row(2, { author: 'same', publishedAt: '2026-09-20' }), row(3, { author: '' }), row(4, { author: '' }), row(5, { platform: 'linkedin' })], { perAuthorCap: 1, targetPerPlatform: 3, maxEvidenceItems: 4 });
    expect(result.items).toHaveLength(4); expect(result.items.map((i) => i.externalId)).not.toContain('1');
    expect(result.receipt.dropped.authorCap).toBe(1);
  });
  it('does not count reaction detail rows as speech and handles unknown scores honestly', () => {
    const result = prepare([row(1, { type: 'reaction' }), row(2, { raw: {}, metrics: { likes: 0 } })]);
    expect(result.items).toHaveLength(1); expect(result.receipt.dropped.nonSpeech).toBe(1);
    expect(result.items[0]).toMatchObject({ engagement: { value: null }, eligible: { discovery: false, tagging: false } });
  });
  it('scopes IDs to the run and makes repeat preparation deterministic', () => {
    const a = prepare([row(1)]); const again = prepare([row(1)]);
    const b = prepareResearchEvidence({ runId: 'other-run', program: program(), items: [row(1)] });
    expect(a.items[0].id).toBe(again.items[0].id); expect(a.items[0].id).not.toBe(b.items[0].id);
  });
});

describe('complete batch traversal and validated discovery', () => {
  it('plans every item of a 1,203-item cohort including the final partial batch', () => {
    const items = cohort(1203); const result = buildDiscoveryBatches({ runId: 'run-a', items, maxCharacters: 500000 });
    expect(result.batches.map((b) => b.items.length)).toEqual([200, 200, 200, 200, 200, 200, 3]);
    expect(new Set(result.batches.flatMap((b) => b.evidenceIds)).size).toBe(1203);
    expect(result.receipt).toMatchObject({ eligibleCount: 1203, plannedCount: 1203, batchCount: 7 });
  });
  it('plans the entire supported 10,000-row cohort without sampling the first batch', () => {
    const items = cohort(10000, { targetPerPlatform: 10000 });
    const result = buildDiscoveryBatches({ runId: 'run-a', items });
    expect(result.receipt.plannedCount).toBe(10000);
    expect(new Set(result.batches.flatMap((batch) => batch.evidenceIds)).size).toBe(10000);
    expect(result.batches.every((batch) => batch.items.length <= 200)).toBe(true);
  });
  it('bounds context characters, returns an empty completion plan, and rejects foreign runs', () => {
    const items = cohort(50).map((item) => ({ ...item, text: 'x'.repeat(8000) }));
    const result = buildDiscoveryBatches({ runId: 'run-a', items, maxCharacters: 60000 });
    expect(result.batches.length).toBeGreaterThan(1); expect(result.receipt.plannedCount).toBe(50);
    expect(buildDiscoveryBatches({ runId: 'run-a', items: [] })).toMatchObject({ batches: [], receipt: { batchCount: 0, plannedCount: 0 } });
    expect(() => buildDiscoveryBatches({ runId: 'other', items })).toThrow(/run/);
  });
  it('derives evidence counts from known IDs or short refs and drops invented or duplicate IDs', () => {
    const items = cohort(3); const batch = buildDiscoveryBatches({ runId: 'run-a', items }).batches[0];
    const output = candidateOutput(batch); const result = validateCandidates(output, { runId: 'run-a', batch });
    expect(result.candidates[0]).toMatchObject({ evidenceCount: 2, platforms: ['x'] });
    const check = (evidenceIds) => validateCandidates({ candidates: [{ ...output.candidates[0], evidenceIds }] }, { runId: 'run-a', batch });
    // Short refs (case-insensitive) map back to evidence IDs; a mis-copied ID is dropped, not fatal.
    expect(check(['p1', 'P2']).candidates[0].evidenceIds).toEqual([batch.evidenceIds[0], batch.evidenceIds[1]]);
    expect(check([batch.evidenceIds[0], batch.evidenceIds[0]]).candidates[0].evidenceCount).toBe(1);
    const mixed = check([batch.evidenceIds[0], 'evidence-5e9d45dd5e9d45dd5e9d45dd']);
    expect(mixed.candidates[0].evidenceIds).toEqual([batch.evidenceIds[0]]); expect(mixed.receipt).toMatchObject({ droppedRefs: 1, droppedCandidates: 0 });
    // A candidate with no real evidence is dropped; a batch where nothing survives asks for a repair.
    for (const ids of [['invented'], []]) expect(() => check(ids)).toThrow(/not in this batch/);
    const kept = validateCandidates({ candidates: [output.candidates[0], { ...output.candidates[0], name: 'Unsupported idea', evidenceIds: ['p99'] }] }, { runId: 'run-a', batch });
    expect(kept.candidates.map((c) => c.name)).toEqual([output.candidates[0].name]); expect(kept.receipt.droppedCandidates).toBe(1);
  });
  it('requires batch-local evidence even if another item belongs to the same run', () => {
    const items = cohort(201); const batch = buildDiscoveryBatches({ runId: 'run-a', items }).batches[0];
    const output = candidateOutput(batch); output.candidates[0].evidenceIds = [items[200].id];
    expect(() => validateCandidates(output, { runId: 'run-a', batch, items })).toThrow(/not in this batch/);
  });
  it('accepts fewer than six themes, reuses stable IDs after renaming and deduplicates counts', () => {
    const { candidates } = makeCandidates(cohort(3)); const result = validateThemes(themeOutput(candidates, { existingThemeId: 'existing-theme' }), { runId: 'run-a', candidates, previousThemes: [{ id: 'existing-theme', name: 'Old verbose reporting theme' }] });
    expect(result.themes).toHaveLength(1); expect(result.themes[0]).toMatchObject({ id: 'existing-theme', evidenceCount: 2, aliases: ['Old verbose reporting theme'] });
    expect(validateThemes({ themes: [] }, { runId: 'run-a', candidates }).themes).toEqual([]);
    expect(() => validateThemes(themeOutput(candidates, { existingThemeId: 'invented' }), { runId: 'run-a', candidates })).toThrow(/known stable/);
  });
});

describe('classification coverage and replacement', () => {
  it('uses the same 0.55 threshold for review and rejects 0.54 even with a proposed theme', () => {
    const items = cohort(4); const result = validAssignments(items, [{ confidence: 0.54 }, { confidence: 0.55 }, { confidence: 0.7 }, { themeId: null, confidence: 0.99 }]);
    expect(result.assignments.map((a) => a.status)).toEqual(['rejected', 'needs-review', 'accepted', 'rejected']);
    expect(result.assignments[0].themeId).toBeNull(); expect(result.assignments[0].suggestedThemeId).toBe('theme-a');
    expect(result.receipt.complete).toBe(true);
  });
  it('returns missing IDs for retries and prevents ID, theme, enum and confidence injection', () => {
    const items = cohort(2); const batch = buildAssignmentBatches({ runId: 'run-a', items }).batches[0]; const options = { runId: 'run-a', batch, themes: [{ id: 'theme-a' }] };
    const partial = validateAssignments({ assignments: [assign(items[0])] }, options);
    expect(partial.missingIds).toEqual([items[1].id]); expect(partial.receipt.complete).toBe(false);
    // A bad row is skipped (its post stays missing for the focused retry); only a response with no usable row fails.
    for (const extra of [{ itemId: 'other-run-id' }, { themeId: 'fake-theme' }, { confidence: 1.1 }, { confidence: '0.9' }, { painPoint: 'Invented taxonomy' }, { urgency: 'BUY NOW' }]) {
      expect(() => validateAssignments({ assignments: [assign(items[0], 'theme-a', extra)] }, options)).toThrow(/No usable assignments/);
      const result = validateAssignments({ assignments: [assign(items[0], 'theme-a', extra), assign(items[1])] }, options);
      expect(result.assignments.map((a) => a.itemId)).toEqual([items[1].id]); expect(result.missingIds).toEqual([items[0].id]); expect(result.receipt.ignoredCount).toBe(1);
    }
    const repeated = validateAssignments({ assignments: [assign(items[0]), assign(items[0])] }, options);
    expect(repeated.assignments).toHaveLength(1); expect(repeated.receipt.ignoredReasons).toEqual(['A post was returned more than once.']);
  });
  it('maps short record ids and Theme IDs from the tagging prompt back to evidence and theme IDs', () => {
    const items = cohort(2); const batch = buildAssignmentBatches({ runId: 'run-a', items }).batches[0];
    const result = validateAssignments({ assignments: [assign(items[0], 'T1', { itemId: 'p1' }), assign(items[1], 't2', { itemId: 'P2' })] }, { runId: 'run-a', batch, themes: [{ id: 'theme-a' }, { id: 'theme-b' }] });
    expect(result.assignments.map((a) => [a.itemId, a.themeId])).toEqual([[items[0].id, 'theme-a'], [items[1].id, 'theme-b']]);
    expect(result.receipt).toMatchObject({ complete: true, ignoredCount: 0 });
  });
  it('replaces prior positive tags with an explicit rejection, preserving other runs', () => {
    const items = cohort(1); const previous = validAssignments(items).assignments; const next = validAssignments(items, [{ confidence: 0.2 }]).assignments;
    const combined = applyAssignments([...previous, { ...previous[0], runId: 'old-run' }], next);
    expect(combined.find((a) => a.runId === 'run-a')).toMatchObject({ themeId: null, status: 'rejected' });
    expect(combined.find((a) => a.runId === 'old-run').themeId).toBe('theme-a');
  });
});

describe('honest history and editorial priority', () => {
  const theme = { id: 'theme-a' }; const period = { startDate: '2026-09-20', endDate: '2026-09-26' };
  const previous = { runId: 'previous', themeId: 'theme-a', cohortKey: 'same-sources-v1', period: { startDate: '2026-09-13', endDate: '2026-09-19' }, complete: true, matchedCount: 2, cohortCount: 10 };
  it('keeps recurrence separate from comparable sampled-share growth', () => {
    const items = cohort(10); const assignments = validAssignments(items, items.map((_, i) => i < 4 ? {} : { themeId: null })).assignments;
    const result = calculateThemeHistory({ theme, runId: 'run-a', period, items, assignments, previousSnapshots: [previous, previous], cohortKey: 'same-sources-v1' });
    expect(result.recurrence).toEqual({ observedRunCount: 2, label: 'REPEATED' });
    expect(result.growth).toMatchObject({ comparable: true, currentShare: 0.4, previousShare: 0.2, percentagePointChange: 20, relativePercentChange: 100 });
  });
  it('does not compare different source configurations, unequal periods, or incomplete runs', () => {
    const items = cohort(2); const assignments = validAssignments(items).assignments;
    for (const extra of [{ cohortKey: 'changed' }, { complete: false }, { previousSnapshots: [{ ...previous, period: { startDate: '2026-09-01', endDate: '2026-09-19' } }] }]) {
      const result = calculateThemeHistory({ theme, runId: 'run-a', period, items, assignments, cohortKey: 'same-sources-v1', previousSnapshots: [previous], ...extra });
      expect(result.growth).toMatchObject({ comparable: false, relativePercentChange: null });
    }
  });
  it('withholds growth when eligible rows have not all been classified', () => {
    const items = cohort(10); const assignments = validAssignments(items).assignments.slice(0, 4);
    const result = calculateThemeHistory({ theme, runId: 'run-a', period, items, assignments, previousSnapshots: [previous], cohortKey: 'same-sources-v1' });
    expect(result.snapshot.complete).toBe(false); expect(result.growth.comparable).toBe(false);
  });
  it('does not invent infinite growth from a zero baseline', () => {
    const items = cohort(2); const assignments = validAssignments(items).assignments;
    expect(calculateThemeHistory({ theme, runId: 'run-a', period, items, assignments, previousSnapshots: [{ ...previous, matchedCount: 0 }], cohortKey: 'same-sources-v1' }).growth).toMatchObject({ comparable: true, relativePercentChange: null, previousShare: 0 });
  });
  it('sizes the AI estimate from what each source can return', () => {
    const sources = [{ platform: 'x', targets: ['a', 'b'] }, { platform: 'reddit', targets: ['seo', 'bigseo'] }];
    const small = engine.estimateResearchCost(program({ sourceGroups: sources }));
    // X: accounts × per-author cap; Reddit: subreddits × 300 posts per /new/ listing.
    expect(small.posts).toMatchObject({ x: 20, reddit: 600, total: 620 });
    expect(small.totalUsd).toBeCloseTo(Object.values(small.stages).reduce((sum, value) => sum + value, 0), 2);
    const roster = engine.estimateResearchCost(program({ sourceGroups: [{ platform: 'reddit', targets: Array.from({ length: 18 }, (_, i) => `sub${i}`) }] }));
    expect(roster.posts.reddit).toBe(3000);
    // Topic-filtered Reddit search is not bounded per community, so it keeps the platform target.
    expect(engine.estimateResearchCost(program({ sourceGroups: sources, query: 'AI Overviews', topicFiltersTargets: true })).posts.reddit).toBe(3000);
    const opusTagging = engine.estimateResearchCost(program({ sourceGroups: sources, ai: { models: { tagging: 'claude-opus-5-5' } } }));
    expect(opusTagging.stages.tagging).toBeLessThan(small.stages.tagging);
    expect(opusTagging.stages.discovery).toBe(small.stages.discovery);
  });
  it('scores priority exactly like the n8n Calculate Trend Velocity node', () => {
    const taxonomy = { categories: [{ category: 'Analytics & Measurement', zone: 'OPEN', velocity: 'DORMANT', articleCount: 69, last6Mo: 8, topKeywords: ['analytics'], topPhrases: ['google analytics'], monthly: [{ count: 2 }, { count: 0 }, { count: 0 }], editorialAction: 'Fast-track.' }, { category: 'Technical SEO', zone: 'SATURATED', velocity: 'DORMANT', articleCount: 125, last6Mo: 21, topKeywords: ['crawl'], topPhrases: ['technical seo'], monthly: [{ count: 3 }, { count: 4 }, { count: 3 }] }] };
    // No taxonomy match → NEW_TERRITORY (5×2) + NEW (1×1.5) + NEW TOPIC (3) + UNKNOWN recency (0.5) = 15 → FAST-TRACK.
    expect(calculateThemePriority({ theme: { name: 'Bing AI Citations Dashboard', novelty: 'NEW TOPIC' } })).toMatchObject({ score: 15, tier: 'FAST-TRACK', gapSignal: 'NEW_TERRITORY', velocity: 'NEW' });
    // OPEN zone → HIGH_OPPORTUNITY (8) + ACCELERATING after 3 detections (4.5) + NEW ANGLE (2) + DORMANT (1) = 15.5.
    const open = calculateThemePriority({ theme: { name: 'GA4 Attribution Collapse', novelty: 'NEW ANGLE', taxonomyCategory: 'Analytics & Measurement' }, detectionCount: 3, taxonomy });
    expect(open).toMatchObject({ score: 15.5, tier: 'FAST-TRACK', gapSignal: 'HIGH_OPPORTUNITY', velocity: 'ACCELERATING', recentTrend: 'DORMANT', components: { gap: 8, velocity: 4.5, novelty: 2, recency: 1, phrasePenalty: 0 } });
    // SATURATED + ACTIVE (last 3 months = 10) → LOW_OPPORTUNITY; a top-phrase overlap costs 2 more.
    const saturated = calculateThemePriority({ theme: { name: 'Technical SEO Crawl Budget Panic', description: 'technical seo teams', novelty: 'EVERGREEN', taxonomyCategory: 'Technical SEO' }, detectionCount: 2, taxonomy });
    expect(saturated).toMatchObject({ score: 4, tier: 'LOW', components: { gap: 2, velocity: 3, novelty: 1, recency: 0, phrasePenalty: -2 }, gapSignal: 'LOW_OPPORTUNITY', velocity: 'EMERGING', recentTrend: 'ACTIVE', phraseOverlap: ['technical seo'] });
  });
});

describe('whole-cohort report evidence and quotes', () => {
  it('balances limited report sources while retaining metrics across every matched item', () => {
    const raw = [...Array.from({ length: 30 }, (_, i) => row(i + 1)), ...Array.from({ length: 2 }, (_, i) => row(i + 101, { platform: 'linkedin' })), ...Array.from({ length: 2 }, (_, i) => row(i + 201, { platform: 'reddit', raw: { upVotes: 30, numberOfComments: 9, upvoteRatio: 0.8 } }))];
    const items = prepare(raw).items; const assignments = validAssignments(items).assignments;
    const snapshot = buildThemeEvidenceSnapshot({ runId: 'run-a', theme: { id: 'theme-a', name: 'Reporting friction' }, items, assignments, maxItems: 6 });
    expect(snapshot.items.map((i) => i.platform)).toEqual(['x', 'linkedin', 'reddit', 'x', 'linkedin', 'reddit']);
    expect(snapshot.coverage).toMatchObject({ cohortCount: 34, matchedCount: 34, selectedCount: 6, omittedCount: 28 });
    expect(snapshot.metrics.matched.platforms.x.metrics.likes).toMatchObject({ total: 2970, knownCount: 30, missingCount: 0 });
    expect(snapshot.metrics.matched.platforms.reddit.metrics.upvoteRatio).toEqual({ average: 0.8, knownCount: 2, missingCount: 0 });
  });
  it('validates exact quotes against selected source text and derives attribution itself', () => {
    const items = cohort(2); const assignments = validAssignments(items).assignments;
    const snapshot = buildThemeEvidenceSnapshot({ runId: 'run-a', theme: { id: 'theme-a', name: 'Reporting' }, items, assignments, maxItems: 1 });
    const item = snapshot.items[0];
    expect(validateExactQuotes([{ evidenceId: item.id, quote: 'useful market feedback', url: 'https://invented.test' }], snapshot)[0]).toMatchObject({ url: item.url, author: item.author });
    expect(() => validateExactQuotes([{ evidenceId: item.id, quote: 'Useful market feedback' }], snapshot)).toThrow(/exact substrings/);
    expect(() => validateExactQuotes([{ evidenceId: items.find((i) => i.id !== item.id).id, quote: 'useful market feedback' }], snapshot)).toThrow(/selected/);
  });
  it('retains unknown aggregate values as null rather than claiming zero activity', () => {
    const items = prepare([row(1, { raw: {} })]).items;
    const snapshot = buildThemeEvidenceSnapshot({ runId: 'run-a', theme: { id: 'theme-a' }, items, assignments: [] });
    expect(snapshot.metrics.cohort.platforms.x.metrics.likes).toMatchObject({ total: null, knownCount: 0, missingCount: 1 });
    expect(snapshot.coverage).toMatchObject({ matchedCount: 0, selectedCount: 0 });
  });
});
