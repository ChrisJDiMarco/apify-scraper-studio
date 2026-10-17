import { describe, expect, it } from 'vitest';
import quick from '../src/shared/research-quick-scan.js';
import research from '../src/shared/research-program.js';
import collection from '../src/shared/research-collection.js';
const { QUICK_SCAN, normalizeScan, rankTargetsForTopic, selectQuickScanTargets, deriveQuickScanProgram, describeScan, scanFingerprint } = quick;
const { validateResearchProgram, resolveResearchWindow, prepareResearchEvidence } = research;
const { buildCollectionPlan } = collection;
const now = new Date('2026-10-17T12:00:00Z');
const names = (count, prefix) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
const saved = (extra = {}) => ({ id: 'program-pulse', name: 'Weekly pulse', query: 'SEO', schedule: { frequency: 'weekly', enabled: true, time: '09:00', timeZone: 'UTC', weekday: 1 }, budgets: { collectionUsd: 10, aiUsd: 25 }, sourceGroups: [{ id: 'x', platform: 'x', targets: names(30, 'account') }, { id: 'li', sourceId: 'linkedin-profile', platform: 'linkedin', targets: names(20, 'https://www.linkedin.com/in/person-') }, { id: 'rd', platform: 'reddit', targets: names(12, 'community') }], ...extra });
const post = (platform, author, text, extra = {}) => ({ platform, author, text, ...extra });
const fieldOf = (fn) => { try { fn(); } catch (error) { return error.field; } return null; };

describe('normalizeScan', () => {
  it('fills every -1 or missing number from the depth preset', () => {
    const preset = QUICK_SCAN.presets.lite;
    expect(normalizeScan({ topic: 'SEO', itemsPerPlatform: -1, maxTargets: { x: -1 } })).toEqual({ topic: 'SEO', depth: 'lite', platforms: ['x', 'linkedin', 'reddit'], maxTargets: preset.maxTargets, itemsPerPlatform: preset.itemsPerPlatform, commentsPerPost: preset.commentsPerPost, lookbackHours: preset.lookbackHours, aiBudgetUsd: preset.aiBudgetUsd, collectionBudgetUsd: preset.collectionBudgetUsd, programId: '' });
  });
  it('applies overrides, then clamps them to the limits', () => {
    const scan = normalizeScan({ topic: '  SEO\n news ', depth: 'deep', platforms: ['reddit', 'Twitter', 'x'], maxTargets: { x: 500, linkedin: 0, reddit: -1 }, itemsPerPlatform: 3, commentsPerPost: 99, lookbackHours: 1000, aiBudgetUsd: 0.1, collectionBudgetUsd: '75', programId: 'program-pulse' });
    expect(scan).toEqual({ topic: 'SEO news', depth: 'deep', platforms: ['x', 'reddit'], maxTargets: { x: 50, linkedin: 1, reddit: QUICK_SCAN.presets.deep.maxTargets.reddit }, itemsPerPlatform: 10, commentsPerPost: 50, lookbackHours: 168, aiBudgetUsd: 0.25, collectionBudgetUsd: 50, programId: 'program-pulse' });
    expect(normalizeScan(scan)).toEqual(scan);
  });
  it('names the field it refuses', () => {
    expect(fieldOf(() => normalizeScan({ topic: '   ' }))).toBe('topic');
    expect(fieldOf(() => normalizeScan({ topic: 'SEO', depth: 'huge' }))).toBe('depth');
    expect(fieldOf(() => normalizeScan({ topic: 'SEO', platforms: ['tiktok'] }))).toBe('platforms');
    expect(fieldOf(() => normalizeScan({ topic: 'SEO', itemsPerPlatform: 'lots' }))).toBe('itemsPerPlatform');
    expect(fieldOf(() => normalizeScan({ topic: 'SEO', programId: '../etc' }))).toBe('programId');
    expect(fieldOf(() => normalizeScan(null))).toBe('scan');
  });
});

describe('rankTargetsForTopic', () => {
  const program = saved({ sourceGroups: [{ id: 'x', platform: 'x', targets: ['alpha', 'beta', 'gamma', 'seonews', 'delta'] }, { id: 'rd', platform: 'reddit', targets: ['bigseo', 'cooking'] }] });
  const evidence = [
    { runId: 'run-new', items: [post('x', 'beta', 'An SEO audit checklist'), post('x', 'gamma', 'Lunch'), post('x', 'gamma', 'Coffee'), post('x', 'gamma', 'Dinner'), post('reddit', '', 'Pasta night', { community: 'cooking' })] },
    { runId: 'run-old', items: [post('x', 'alpha', 'Technical SEO notes')] },
  ];
  it('ranks by recent topic posts, then the name, then activity, then saved order', () => {
    const ranking = rankTargetsForTopic({ program, topic: 'SEO', evidence });
    expect(ranking.map((entry) => entry.target)).toEqual(['beta', 'alpha', 'seonews', 'bigseo', 'gamma', 'cooking', 'delta']);
    expect(ranking[0]).toMatchObject({ sourceGroupId: 'x', platform: 'x', score: 1, reasons: ['1 recent post on this topic'] });
    expect(ranking[1].score).toBe(0.7); // one run older counts 70%
    expect(ranking[2].reasons).toEqual(['Name matches “seo”']);
  });
  it('gives the same answer whatever order the posts arrive in', () => {
    const shuffled = evidence.map((run) => ({ ...run, items: [...run.items].reverse() }));
    expect(rankTargetsForTopic({ program, topic: 'SEO', evidence: shuffled })).toEqual(rankTargetsForTopic({ program, topic: 'SEO', evidence }));
    expect(rankTargetsForTopic({ program, topic: 'SEO', evidence: [] }).map((entry) => entry.target)).toEqual(['seonews', 'bigseo', 'alpha', 'beta', 'gamma', 'delta', 'cooking']);
  });
  it('matches LinkedIn profiles by author or post URL and leaves keyword groups unranked', () => {
    const linkedin = saved({ sourceGroups: [{ id: 'li', sourceId: 'linkedin-profile', platform: 'linkedin', targets: ['https://www.linkedin.com/in/sam-writes', 'https://www.linkedin.com/in/alex-maps'] }, { id: 'ls', sourceId: 'linkedin-search', platform: 'linkedin', targets: ['seo tools'] }] });
    const ranking = rankTargetsForTopic({ program: linkedin, topic: 'SEO', evidence: [{ runId: 'run-a', items: [post('linkedin', 'sam-writes', 'SEO update'), post('linkedin', '', 'SEO news', { url: 'https://www.linkedin.com/posts/alex-maps_seo-activity-1' }), post('linkedin', '', 'More SEO', { url: 'https://www.linkedin.com/posts/alex-maps_seo-activity-2' })] }] });
    expect(ranking.map((entry) => [entry.target, entry.score])).toEqual([['https://www.linkedin.com/in/alex-maps', 2], ['https://www.linkedin.com/in/sam-writes', 1]]);
  });
});

describe('deriveQuickScanProgram', () => {
  it('returns a new, valid program for one run and leaves the saved one untouched', () => {
    const program = saved(); const before = JSON.stringify(program);
    const derived = deriveQuickScanProgram(program, normalizeScan({ topic: 'SEO', depth: 'lite', lookbackHours: 6 }), { now });
    expect(JSON.stringify(program)).toBe(before);
    expect(validateResearchProgram(derived)).toEqual(derived);
    expect(derived).toMatchObject({ id: 'program-pulse', name: 'Quick scan · SEO', query: 'SEO', lookbackHours: 6, window: { startDate: '2026-10-17', endDate: '', startAt: '2026-10-17T06:00:00.000Z' }, schedule: { frequency: 'manual', enabled: false }, autoApproveThemes: false, maxThemes: 3, targetPerPlatform: 60, budgets: { collectionUsd: 1.5, aiUsd: 1.5 }, delivery: { publishToDrive: false } });
    expect(derived.sourceGroups.map((group) => [group.id, group.targets.length])).toEqual([['x', 8], ['li', 6], ['rd', 4]]);
    // Small scans use the cheapest discovery-capable model at low effort for every stage they could call.
    expect(new Set(Object.values(derived.ai.models))).toEqual(new Set(['claude-sonnet-5-5']));
    expect(Object.values(derived.ai.effort).every((effort) => effort === 'low')).toBe(true);
    // A six-hour window scales the discovery engagement bar down to an eighth.
    expect(derived.thresholds.discovery).toEqual({ x: 5, linkedin: 3, reddit: 1 });
  });
  it('follows the ranking, leaves out platforms with no sources and searches the topic instead of saved phrases', () => {
    const program = saved({ sourceGroups: [{ id: 'x', platform: 'x', targets: ['alpha', 'beta', 'gamma'] }, { id: 'ls', sourceId: 'linkedin-search', platform: 'linkedin', targets: ['seo tools', 'rank tracking'] }] });
    const ranking = rankTargetsForTopic({ program, topic: 'SEO', evidence: [{ runId: 'run-a', items: [post('x', 'gamma', 'SEO is changing')] }] });
    const scan = normalizeScan({ topic: 'SEO', depth: 'standard', maxTargets: { x: 1 } });
    const derived = deriveQuickScanProgram(program, scan, { ranking, now });
    expect(derived.sourceGroups).toEqual([expect.objectContaining({ id: 'x', targets: ['gamma'] }), expect.objectContaining({ id: 'ls', targets: ['SEO'] })]);
    expect(selectQuickScanTargets(program, scan, ranking).warnings).toEqual([expect.stringMatching(/no Reddit sources/)]);
    // Larger scans keep the program's models; stages a scan never runs mirror synthesis.
    expect(derived.ai.models).toMatchObject({ discovery: 'claude-opus-5-5', tagging: derived.ai.models.synthesis, reports: derived.ai.models.synthesis });
    expect(() => deriveQuickScanProgram(program, normalizeScan({ topic: 'SEO', platforms: ['reddit'] }), { now })).toThrow(/no Reddit sources/);
  });
  it('sizes every preset inside its collection cap and passes each Actor the exact start', () => {
    for (const depth of ['lite', 'standard', 'deep']) {
      const derived = deriveQuickScanProgram(saved(), normalizeScan({ topic: 'SEO', depth }), { now });
      const plan = buildCollectionPlan(derived, { now });
      expect(plan.receipt.worstCaseUsd).toBeLessThanOrEqual(derived.budgets.collectionUsd);
      expect(plan.receipt.totalBudgetUsd).toBeLessThanOrEqual(derived.budgets.collectionUsd);
    }
    const lite = buildCollectionPlan(deriveQuickScanProgram(saved(), normalizeScan({ topic: 'SEO', lookbackHours: 12 }), { now }), { now });
    const startAt = '2026-10-17T00:00:00.000Z';
    // A lite scan's 8 X accounts split into 2 jobs of 5 and 3; each source's first job is checked.
    const bySource = Object.fromEntries([...lite.jobs].reverse().map((job) => [job.sourceId, job.recipe.input]));
    expect(lite.jobs.filter((job) => job.sourceId === 'x').map((job) => job.targets.length)).toEqual([5, 3]);
    expect(bySource.x.searchTerms[0]).toBe(`from:account0 since_time:${Date.parse(startAt) / 1000}`);
    expect(bySource['linkedin-profile'].postedLimitDate).toBe(startAt);
    expect(bySource.reddit).toMatchObject({ postDateLimit: startAt, commentDateLimit: startAt, skipComments: true });
    expect(lite.window).toMatchObject({ startAt, resolvedFrom: 'program' });
  });
});

describe('hour-level windows', () => {
  const base = { name: 'Pulse', sourceGroups: [{ platform: 'x', targets: ['writer'] }] };
  it('leaves programs without the new fields exactly as before', () => {
    const plain = validateResearchProgram(base);
    expect('lookbackHours' in plain).toBe(false);
    expect(plain.window).toEqual({ startDate: '', endDate: '' });
    expect(resolveResearchWindow(plain, now)).toEqual({ startDate: '2026-10-10', endDate: '', resolvedFrom: 'lookback', lookbackDays: 7 });
  });
  it('resolves lookbackHours to an exact start and rejects a mismatched or invalid one', () => {
    expect(resolveResearchWindow(validateResearchProgram({ ...base, lookbackHours: 6 }), now)).toEqual({ startDate: '2026-10-17', endDate: '', startAt: '2026-10-17T06:00:00.000Z', resolvedFrom: 'lookback', lookbackHours: 6 });
    expect(() => validateResearchProgram({ ...base, window: { startAt: '2026-10-17T06:00:00Z', startDate: '2026-10-16' } })).toThrow(/day of the start time/);
    expect(() => validateResearchProgram({ ...base, window: { startAt: 'yesterday' } })).toThrow(/ISO/);
    expect(() => validateResearchProgram({ ...base, lookbackHours: 0 })).toThrow(/lookbackHours/);
  });
  it('keeps evidence from the exact start time', () => {
    const row = (id, publishedAt) => ({ id: `row-${id}`, externalId: String(id), platform: 'x', type: 'post', author: `writer${id}`, text: `Post ${id}`, url: `https://x.com/writer${id}/status/${id}`, publishedAt });
    const result = prepareResearchEvidence({ runId: 'run-a', program: { ...base, window: { startAt: '2026-10-17T06:00:00Z' } }, items: [row(1, '2026-10-17T05:59:59Z'), row(2, '2026-10-17T06:00:00Z')] });
    expect(result.items.map((item) => item.externalId)).toEqual(['2']);
    expect(result.receipt.dropped.outsideWindow).toBe(1);
  });
});

describe('scanFingerprint and describeScan', () => {
  it('stays the same across time and changes with the plan', () => {
    const scan = normalizeScan({ topic: 'SEO' });
    const first = scanFingerprint(deriveQuickScanProgram(saved(), scan, { now }));
    expect(scanFingerprint(deriveQuickScanProgram(saved(), scan, { now: new Date('2026-10-17T12:10:00Z') }))).toBe(first);
    expect(scanFingerprint(deriveQuickScanProgram(saved(), { ...scan, aiBudgetUsd: 2 }, { now }))).not.toBe(first);
    expect(scanFingerprint(deriveQuickScanProgram(saved(), { ...scan, maxTargets: { ...scan.maxTargets, x: 7 } }, { now }))).not.toBe(first);
    expect(scanFingerprint({ b: 1, a: { d: 1, c: 2 } })).toBe(scanFingerprint({ a: { c: 2, d: 1 }, b: 1 }));
  });
  it('describes the scan in plain lines, with the Codex note when spend is not capped', () => {
    const scan = normalizeScan({ topic: 'SEO', lookbackHours: 6, platforms: ['x'] });
    const { targets, platforms, available } = selectQuickScanTargets(saved(), scan);
    const lines = describeScan(scan, { platforms, targets, available, ai: { totalUsd: 0.34 }, collection: { worstCaseUsd: 0.17 }, uncapped: true });
    expect(lines[0]).toBe('Small and cheap scan of “SEO” over the last 6 hours.');
    expect(lines).toContain('X: 8 of 30 accounts (@account0, @account1, @account2 and 5 more).');
    expect(lines.join(' ')).toMatch(/Codex doesn't report cost/);
    expect(lines.join(' ')).toMatch(/up to \$0\.17 in the worst case, capped at \$1\.50/);
  });
});
