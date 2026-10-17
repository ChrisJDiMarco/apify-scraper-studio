import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import trendHistory from '../src/shared/trend-history.js';
import storeModule from '../src/main/workbooks.js';
const { MOMENTUM, TREND_TRACKER_ID, buildTrendHistory, buildTrendTrackerWorkbook, computeThemeStats, findTrend, isoWeek, momentumFor, rankPosts, normalizeText, trendChanges, trendMemoryDigest, trendNameKey, trendSimilarity } = trendHistory;
const { createWorkbookStore } = storeModule;

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const NOW = new Date('2026-10-17T12:00:00Z');
const theme = (id, name, extra = {}) => ({ id, name, description: `${name}.`, matchingKeywords: [], taxonomyCategory: 'AI Search', evidenceCount: 10, platforms: ['x'], ...extra });
// A finished research run of program p1 with every theme approved, kept posts = 1,000.
const run = (id, date, themes, extra = {}) => ({ id, programId: 'p1', title: 'Weekly SEO trends', status: 'succeeded', stage: 'reports', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T11:00:00Z`, window: { startDate: '', endDate: '' }, counts: { retained: 1000, discoveryEligible: 500, platforms: { x: 700, linkedin: 200, reddit: 100 } }, discoveredThemes: themes, themes, approvedAt: `${date}T10:30:00Z`, decisions: Object.fromEntries(themes.map((entry) => [entry.id, 'approved'])), ...extra });
const snapshot = (runId, themeId, share) => ({ runId, themeId, share, cohortCount: 1000, matchedCount: Math.round(share * 1000) });
const tagged = (total) => ({ posts: { x: total, linkedin: 0, reddit: 0, total }, prevalence: { x: total * 2, linkedin: 0, reddit: 0, total: total * 2 }, needsReview: 0 });
const trendNamed = (history, name) => history.trends.find((trend) => trend.name === name || trend.aliases.includes(name));
// One appearance for momentumFor: one run, one share.
const seen = (runId, share, basis = 'tagged') => ({ runId, share, basis, posts: { total: Math.round(share * 1000) } });

describe('linking a trend across runs', () => {
  it('keeps one trend for the same theme id in every run', () => {
    const history = buildTrendHistory({ runs: [run('r1', '2026-09-28', [theme('t-a', 'AI Overviews eat branded clicks')]), run('r2', '2026-10-05', [theme('t-a', 'AI Overviews eat branded clicks')])] }, { now: NOW });
    expect(history.trends).toHaveLength(1);
    expect(history.trends[0]).toMatchObject({ trendId: 't-a', runsSeen: 2, firstSeen: '2026-09-28', lastSeen: '2026-10-05', origin: 'research' });
    expect(history.trends[0].appearances.map((entry) => entry.runId)).toEqual(['r1', 'r2']);
  });

  it('links a renamed trend through its aliases and the tracked match', () => {
    const renamed = theme('t-b2', 'Copilot answer share dashboards', { aliases: ['Bing Copilot citation tracking'] });
    const matched = theme('t-c2', 'Perplexity referral analytics', { match: { matched: true, existingThemeId: 't-c', existingName: 'Answer engine traffic' } });
    const history = buildTrendHistory({ runs: [run('r1', '2026-09-28', [theme('t-b', 'Bing Copilot citation tracking'), theme('t-c', 'Answer engine traffic')]), run('r2', '2026-10-05', [renamed, matched])] }, { now: NOW });
    expect(history.trends).toHaveLength(2);
    const copilot = trendNamed(history, 'Copilot answer share dashboards');
    expect(copilot).toMatchObject({ trendId: 't-b', themeIds: ['t-b', 't-b2'], runsSeen: 2 });
    expect(copilot.aliases).toContain('Bing Copilot citation tracking');
    expect(trendNamed(history, 'Perplexity referral analytics')).toMatchObject({ trendId: 't-c', themeIds: ['t-c', 't-c2'] });
  });

  it('merges reworded trends whose names and keywords overlap enough', () => {
    const first = theme('t-1', 'AI visibility reporting gap', { matchingKeywords: ['AI visibility', 'client reporting'] });
    const second = theme('t-2', 'AI visibility reporting tools', { matchingKeywords: ['AI visibility', 'client reporting tools'] });
    expect(trendSimilarity(first, second)).toBeGreaterThanOrEqual(0.55);
    expect(trendSimilarity(first, theme('t-3', 'Local pack review spam', { matchingKeywords: ['reviews'] }))).toBeLessThan(0.55);
    expect(trendNameKey('The rise of AI Overviews')).toBe(trendNameKey('AI overview'));
    const history = buildTrendHistory({ runs: [run('r1', '2026-09-28', [first]), run('r2', '2026-10-05', [second])] }, { now: NOW });
    expect(history.trends).toHaveLength(1);
    expect(history.trends[0]).toMatchObject({ trendId: 't-1', name: 'AI visibility reporting tools', runsSeen: 2 });
  });

  it('never merges two themes from the same run, even through a later run', () => {
    const history = buildTrendHistory({ runs: [
      run('r1', '2026-09-28', [theme('t-a', 'Local pack review spam'), theme('t-b', 'Local pack review spam waves')]),
      run('r2', '2026-10-05', [theme('t-c', 'Local pack review spam')]),
    ] }, { now: NOW });
    expect(history.trends).toHaveLength(2);
    for (const trend of history.trends) expect(new Set(trend.appearances.map((entry) => entry.runId)).size).toBe(trend.appearances.length);
    expect(history.trends.find((trend) => trend.themeIds.includes('t-c')).themeIds).toHaveLength(2);
  });

  it('shows quick scans as pulse sightings that never rename or move a research trend', () => {
    const quick = run('q1', '2026-10-06', [theme('t-q', 'AI Overviews eating branded clicks now')], { origin: 'quick-scan', stage: 'scan-complete', themes: [], approvedAt: '', decisions: {} });
    const history = buildTrendHistory({ runs: [run('r1', '2026-10-05', [theme('t-a', 'AI Overviews eat branded clicks')]), quick, run('q2', '2026-10-07', [theme('t-z', 'Schema markup for shopping agents')], { origin: 'quick-scan', stage: 'scan-complete', themes: [], approvedAt: '', decisions: {} })] }, { now: NOW });
    const tracked = history.trends.find((trend) => trend.trendId === 't-a');
    expect(tracked).toMatchObject({ name: 'AI Overviews eat branded clicks', runsSeen: 1, quickScansSeen: 1, momentum: 'new', origin: 'research' });
    expect(tracked.appearances.find((entry) => entry.runId === 'q1')).toMatchObject({ origin: 'quick-scan', basis: 'discovery', decision: 'pending' });
    expect(history.trends.at(-1)).toMatchObject({ trendId: 't-z', origin: 'quick-scan', runsSeen: 0, quickScansSeen: 1 });
    expect(history).toMatchObject({ runCount: 1, quickScanCount: 2 });
    expect(trendChanges(history).newTrends.map((entry) => entry.trendId)).toEqual(['t-a']);
  });
});

describe('momentum from share of posts', () => {
  const runs = ['r1', 'r2', 'r3'];
  it('labels a trend new only in the newest run that could have seen it', () => {
    expect(momentumFor([seen('r3', 0.02)], { eligibleRuns: runs }).momentum).toBe('new');
    expect(momentumFor([seen('r2', 0.02)], { eligibleRuns: runs }).momentum).toBe('steady');
  });

  it('rises at 1.25× the previous share and at least a quarter point', () => {
    expect(momentumFor([seen('r2', 0.02), seen('r3', 0.025)], { eligibleRuns: runs })).toMatchObject({ momentum: 'rising', momentumBasis: { changePp: 0.5, previousRunId: 'r2', missedRuns: 0 } });
    expect(momentumFor([seen('r2', 0.02), seen('r3', 0.0249)], { eligibleRuns: runs }).momentum).toBe('steady');
    expect(momentumFor([seen('r2', 0.001), seen('r3', 0.002)], { eligibleRuns: runs }).momentum).toBe('steady'); // doubled, but only +0.1 pts
    expect(MOMENTUM).toMatchObject({ risingRatio: 1.25, risingMinPp: 0.25, fadingRatio: 0.7, fadingMissedRuns: 2, streakRuns: 3 });
  });

  it('rises on three runs in a row with a share that never drops', () => {
    expect(momentumFor([seen('r1', 0.02), seen('r2', 0.0201), seen('r3', 0.0202)], { eligibleRuns: runs })).toMatchObject({ momentum: 'rising', momentumBasis: { streak: true } });
    expect(momentumFor([seen('r1', 0.02), seen('r2', 0.0199), seen('r3', 0.0202)], { eligibleRuns: runs }).momentum).toBe('steady');
  });

  it('fades below 0.7× the previous share or after two runs without it', () => {
    expect(momentumFor([seen('r2', 0.1), seen('r3', 0.0699)], { eligibleRuns: runs }).momentum).toBe('fading');
    expect(momentumFor([seen('r2', 0.1), seen('r3', 0.07)], { eligibleRuns: runs }).momentum).toBe('steady');
    expect(momentumFor([seen('r1', 0.05)], { eligibleRuns: runs })).toMatchObject({ momentum: 'fading', momentumBasis: { missedRuns: 2 } });
    expect(momentumFor([seen('r1', 0.01), seen('r2', 0.05)], { eligibleRuns: runs }).momentum).toBe('steady'); // grew, but missed the latest run
  });

  it('compares like with like: a tagged share is never measured against a discovery share', () => {
    const result = momentumFor([seen('r2', 0.01, 'discovery'), seen('r3', 0.05, 'tagged')], { eligibleRuns: runs });
    expect(result.momentum).toBe('steady');
    expect(result.momentumBasis.changePp).toBeNull();
  });

  it('reads shares from run snapshots so runs of different sizes compare fairly', () => {
    const big = run('r2', '2026-10-05', [theme('t-a', 'AI Overviews eat branded clicks')], { counts: { retained: 4000 } });
    const history = buildTrendHistory({ runs: [run('r1', '2026-09-28', [theme('t-a', 'AI Overviews eat branded clicks')]), big],
      history: [snapshot('r1', 't-a', 0.02), { ...snapshot('r2', 't-a', 0.03), cohortCount: 4000 }], themeStats: { r1: { tagged: { 't-a': tagged(20) } }, r2: { tagged: { 't-a': tagged(120) } } } }, { now: NOW });
    expect(history.trends[0]).toMatchObject({ momentum: 'rising', latestPosts: 120, latestSharePct: 3, changePp: 1, spark: [20, 120] });
  });
});

describe('Trend tracker workbook', () => {
  const source = (runs) => ({ runs, history: runs.flatMap((entry, index) => entry.themes.map((item) => snapshot(entry.id, item.id, 0.01 + index * 0.005))) });
  const weekly = (count, themesFor) => Array.from({ length: count }, (_, index) => { const date = new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10); return run(`r${index + 1}`, date, themesFor(index)); });

  it('keeps row keys stable when a later run is added', () => {
    const before = buildTrendTrackerWorkbook(source(weekly(2, () => [theme('t-a', 'AI Overviews eat branded clicks'), theme('t-b', 'Reddit threads rank for product queries')])), { now: NOW });
    const runs = weekly(3, (index) => [theme(index === 2 ? 't-a3' : 't-a', 'AI Overviews eat branded clicks'), theme('t-b', 'Reddit threads rank for product queries'), ...(index === 2 ? [theme('t-n', 'Schema markup for shopping agents')] : [])]);
    const after = buildTrendTrackerWorkbook(source(runs), { now: NOW });
    expect(after).toMatchObject({ id: TREND_TRACKER_ID, kind: 'tracker', name: 'Trend tracker' });
    expect(after.sheets.map((sheet) => sheet.name)).toEqual(['Trend timeline', 'Weekly snapshot', 'Category momentum', 'Run log']);
    const keys = (workbook, id) => workbook.sheets.find((sheet) => sheet.id === id).rowKeys;
    for (const id of ['timeline', 'weekly', 'categories', 'runs']) for (const key of keys(before, id)) expect(keys(after, id)).toContain(key);
    expect(keys(after, 'timeline')).toEqual(expect.arrayContaining(['t-a', 't-b', 't-n']));
    for (const sheet of after.sheets) expect(new Set(sheet.rowKeys).size).toBe(sheet.rowKeys.length);
    expect(after.summary).toMatchObject({ runCount: 3, trendCount: 3, sinceRun: { id: 'r3' } });
  });

  it('caps every tab at 60 columns and keeps the newest runs', () => {
    const workbook = buildTrendTrackerWorkbook(source(weekly(70, (index) => [theme(`t-${index}`, 'AI Overviews eat branded clicks'), theme(`u-${index}`, 'Reddit threads rank for product queries', { taxonomyCategory: 'Community' })])), { now: NOW });
    for (const sheet of workbook.sheets) {
      expect(sheet.columns.length).toBeLessThanOrEqual(60);
      for (const row of sheet.rows) expect(row).toHaveLength(sheet.columns.length);
      expect(new Set(sheet.columns).size).toBe(sheet.columns.length);
    }
    const timeline = workbook.sheets.find((sheet) => sheet.id === 'timeline');
    expect(timeline.rows).toHaveLength(2);
    expect(timeline.columns.at(-1)).toBe(`Posts ${workbook.summary.span.to}`);
    expect(timeline.note).toMatch(/newest/);
  });

  it('explains empty tabs instead of showing a blank grid', () => {
    const workbook = buildTrendTrackerWorkbook({ runs: [] }, { now: NOW });
    expect(workbook.sheets.every((sheet) => sheet.rows.length === 0 && sheet.empty?.title)).toBe(true);
    expect(workbook.summary).toMatchObject({ runCount: 0, trendCount: 0, sinceRun: null });
  });
});

describe('what changed and the Ask AI digest', () => {
  it('waits for a second run before comparing', () => {
    const changes = trendChanges(buildTrendHistory({ runs: [run('r1', '2026-10-05', [theme('t-a', 'AI Overviews eat branded clicks')])] }, { now: NOW }));
    expect(changes).toMatchObject({ comparable: false, runCount: 1, sinceRun: { id: 'r1', date: '2026-10-05' }, counts: { new: 1 } });
  });

  it('lists new, rising and fading trends since the last research run', () => {
    const runs = [run('r1', '2026-09-21', [theme('t-old', 'Link building outreach fatigue'), theme('t-up', 'AI Overviews eat branded clicks')]), run('r2', '2026-09-28', [theme('t-up', 'AI Overviews eat branded clicks')]), run('r3', '2026-10-05', [theme('t-up', 'AI Overviews eat branded clicks'), theme('t-new', 'Schema markup for shopping agents')])];
    const history = buildTrendHistory({ runs, history: [snapshot('r1', 't-up', 0.01), snapshot('r2', 't-up', 0.012), snapshot('r3', 't-up', 0.02), snapshot('r1', 't-old', 0.03), snapshot('r3', 't-new', 0.01)] }, { now: NOW });
    const changes = trendChanges(history);
    expect(changes).toMatchObject({ comparable: true, sinceRun: { id: 'r3' }, previousRun: { id: 'r2' }, counts: { new: 1, rising: 1, fading: 1 } });
    expect(changes.newTrends[0].trendId).toBe('t-new');
    expect(changes.rising[0]).toMatchObject({ trendId: 't-up', changePp: 0.8 });
    expect(changes.fading[0]).toMatchObject({ trendId: 't-old', missedRuns: 2 });
  });

  it('keeps the digest under its character budget', () => {
    const names = ['AI Overviews eat branded clicks', 'Reddit threads rank for product queries', 'LLM visibility reporting tools', 'Schema markup for shopping agents', 'Core update volatility in news', 'Local pack review spam waves', 'Video carousels for shopping queries', 'Programmatic pages lose indexing', 'Perplexity referral traffic grows', 'Zero click searches in travel', 'Bing Copilot citation tracking', 'Answer engine product comparisons', 'Branded search demand in retail', 'Agent crawlers and robots rules', 'Query fan out for long questions'];
    const history = buildTrendHistory({ runs: [run('r1', '2026-10-05', names.map((name, index) => theme(`t-${index}`, `${name} ${'with a deliberately long qualifying tail '.repeat(3)}`)))] }, { now: NOW });
    const digest = trendMemoryDigest(history);
    expect(JSON.stringify(digest).length).toBeLessThanOrEqual(3000);
    expect(digest.trends.length).toBeGreaterThan(0);
    expect(digest.trends.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(trendMemoryDigest(history, { maxChars: 700 })).length).toBeLessThanOrEqual(700);
    expect(trendMemoryDigest(buildTrendHistory({ runs: [] }, { now: NOW }))).toMatchObject({ runs: 0, trends: [], note: expect.stringMatching(/No research run/) });
  });

  it('finds one trend by any theme id or a loose name', () => {
    const history = buildTrendHistory({ runs: [run('r1', '2026-09-28', [theme('t-a', 'AI Overviews eat branded clicks')]), run('r2', '2026-10-05', [theme('t-a2', 'AI Overviews eating branded clicks', { aliases: ['AI Overviews eat branded clicks'] })])] }, { now: NOW });
    expect(findTrend(history, { trendId: 't-a2' })?.trendId).toBe('t-a');
    expect(findTrend(history, { name: 'branded clicks' })?.trendId).toBe('t-a');
    expect(findTrend(history, { name: 'Local pack review spam' })).toBeNull();
  });
});

describe('per-run numbers and post search', () => {
  it('counts tagged posts with the theme totals rule and splits discovery evidence by platform', () => {
    const evidence = [{ id: 'e1', platform: 'x', author: 'alex', engagement: { value: 4 }, metrics: { likes: 10 } }, { id: 'e2', platform: 'linkedin', author: 'sam', engagement: { value: 2 }, metrics: { likes: 3 } }, { id: 'e3', platform: 'reddit', author: 'riley', engagement: { value: 1 }, metrics: { upvotes: 5 } }];
    const approved = theme('t-a', 'AI Overviews eat branded clicks', { evidenceIds: ['e1', 'e3'] });
    const passed = theme('t-b', 'Reddit threads rank for product queries', { evidenceIds: ['e3'] });
    const stats = computeThemeStats({ run: { id: 'r1', discoveredThemes: [approved, passed], themes: [approved], approvedAt: '2026-10-05' }, evidence, assignments: [{ itemId: 'e1', themeId: 't-a', status: 'accepted' }, { itemId: 'e2', themeId: 't-a', status: 'needs-review' }, { itemId: 'e3', themeId: 't-a', status: 'rejected' }, { itemId: 'e3', themeId: 't-b', status: 'accepted' }] });
    expect(stats.tagged['t-a']).toMatchObject({ posts: { x: 1, linkedin: 1, reddit: 0, total: 2 }, needsReview: 1, prevalence: { total: 6 }, metrics: { likes: 13 }, authors: 2 });
    expect(stats.tagged['t-b']).toBeUndefined(); // passed themes are never tagged
    expect(stats.discovery['t-b']).toEqual({ x: 0, linkedin: 0, reddit: 1, total: 1 });
    expect(stats).toMatchObject({ retained: 3, discoveryEligible: 3 });
  });

  it('ranks posts by query terms, then engagement, one per link', () => {
    const post = (url, text, engagement) => ({ url, text, engagement, platform: 'x', author: 'jordan', haystack: normalizeText(text) });
    const posts = [post('u1', 'Our AI Overviews clicks fell again', 3), post('u2', 'She said nothing about search', 99), post('u3', 'AI Overviews are everywhere', 50), post('u1', 'Our AI Overviews clicks fell again', 3), post('u4', 'Overviews and clicks, nothing else', 1)];
    const ranked = rankPosts(posts, 'AI Overviews clicks', { limit: 12 });
    expect(ranked.map((entry) => entry.url)).toEqual(['u1', 'u3', 'u4']);
    expect(ranked[0]).not.toHaveProperty('haystack');
    expect(rankPosts(posts, '   ')).toEqual([]);
    expect(rankPosts(posts, 'AI').map((entry) => entry.url)).not.toContain('u2'); // "said" is not "AI"
  });

  it('dates runs by ISO week', () => {
    expect(isoWeek('2026-10-14')).toEqual({ key: '2026-W42', start: '2026-10-12' });
    expect(isoWeek('2021-01-03')).toEqual({ key: '2020-W53', start: '2020-12-28' });
  });
});

describe('Trend tracker in the workbook store', () => {
  // A studio stand-in: the general workspace has two research runs, the semrush workspace none.
  function harness() {
    let workspaceId = 'general'; let version = 1;
    const runs = { general: [run('r1', '2026-09-28', [theme('t-a', 'AI Overviews eat branded clicks')]), run('r2', '2026-10-05', [theme('t-a', 'AI Overviews eat branded clicks')])], semrush: [] };
    const workspace = {
      listResearchWorkbookSources: () => [],
      listTrendHistorySources: vi.fn(() => ({ version: `${workspaceId}:${version}`, runCount: runs[workspaceId].length, runsWithThemes: runs[workspaceId].length, quickScanCount: 0, trendCount: runs[workspaceId].length ? 1 : 0, counts: { rising: 0, new: 0, steady: 1, fading: 0 }, sinceRun: null, createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-10-05T11:00:00Z' })),
      readTrendHistorySource: vi.fn(() => ({ runs: runs[workspaceId], version: `${workspaceId}:${version}` })),
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trend-tracker-store-')); roots.push(root);
    const store = createWorkbookStore({ root, contentWorkspace: workspace, activeWorkspaceId: () => workspaceId, clock: () => NOW });
    return { store, workspace, switchTo: (id) => { workspaceId = id; }, addRun: () => { runs.general.push(run('r3', '2026-10-12', [theme('t-a', 'AI Overviews eat branded clicks'), theme('t-n', 'Schema markup for shopping agents')])); version++; } };
  }

  it('lists the tracker first, only in a workspace whose runs found trends', () => {
    const { store, switchTo } = harness();
    expect(store.list()[0]).toMatchObject({ id: TREND_TRACKER_ID, kind: 'tracker', name: 'Trend tracker', rowCount: 1, runCount: 2 });
    switchTo('semrush');
    expect(store.list().some((entry) => entry.kind === 'tracker')).toBe(false);
  });

  it('rebuilds once per version and keeps reviewer edits, per workspace, across rebuilds', async () => {
    const { store, workspace, switchTo, addRun } = harness();
    await store.read({ workbookId: TREND_TRACKER_ID }); await store.read({ workbookId: TREND_TRACKER_ID });
    expect(workspace.readTrendHistorySource).toHaveBeenCalledTimes(1);
    store.saveEdits({ workbookId: TREND_TRACKER_ID, edits: { version: 1, sheets: { timeline: { 't-a': { 'Last Decision': 'Brief Sam' } } } } });
    addRun();
    const rebuilt = await store.read({ workbookId: TREND_TRACKER_ID });
    expect(workspace.readTrendHistorySource).toHaveBeenCalledTimes(2);
    expect(rebuilt.sheets[0].rowKeys).toEqual(expect.arrayContaining(['t-a', 't-n']));
    expect(rebuilt.edits.sheets.timeline['t-a']['Last Decision']).toBe('Brief Sam');
    switchTo('semrush');
    expect((await store.read({ workbookId: TREND_TRACKER_ID })).edits.sheets).toEqual({});
  });

  it('never removes or renames the tracker', () => {
    const { store } = harness();
    expect(() => store.remove({ workbookId: TREND_TRACKER_ID })).toThrow(/Trend tracker is rebuilt/);
    expect(() => store.rename({ workbookId: TREND_TRACKER_ID, name: 'Mine' })).toThrow(/keeps its name/);
  });
});
