import { describe, expect, it } from 'vitest';
import { buildTrendBoard } from '../src/shared/trend-board.js';
import { NO_FILTERS, activeCount, askAgain, cleanFilters, filterBoard, filterCards, filterChoices, movePlan, stopAsking } from '../src/renderer/src/trend-filters.js';
import { stageIdOf, stageOf } from '../src/renderer/src/trend-stage.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const card = (extra) => ({ key: `r:${extra.name}`, runId: 'r', themeId: extra.name, description: '', evidenceCount: 5, platforms: ['x'], priorityTier: 'STRONG', keywords: [], programName: 'Pulse', discoveredAt: '2026-11-10T10:00:00Z', stage: 'ready', ...extra });
const cards = [
  card({ name: 'AI citations', priorityTier: 'FAST-TRACK', evidenceCount: 50, platforms: ['x', 'reddit'], keywords: ['citation tracking'] }),
  card({ name: 'Zero click', priorityTier: 'MONITOR', evidenceCount: 9, platforms: ['linkedin'], discoveredAt: '2026-10-01T10:00:00Z', description: 'Searches that end without a click' }),
  card({ name: 'Backlink budgets', evidenceCount: 20, discoveredAt: '2026-06-01T10:00:00Z', stage: 'passed' }),
];
const names = (rows) => rows.map((row) => row.name);

describe('filterCards', () => {
  it('keeps everything, in the order it came, with no filters', () => {
    expect(filterCards(cards, NO_FILTERS, NOW)).toEqual(cards);
  });
  it('searches the name, description, keywords and program, every word', () => {
    expect(names(filterCards(cards, { query: 'citation' }, NOW))).toEqual(['AI citations']);
    expect(names(filterCards(cards, { query: 'without CLICK' }, NOW))).toEqual(['Zero click']);
    expect(names(filterCards(cards, { query: 'pulse budgets' }, NOW))).toEqual(['Backlink budgets']);
    expect(filterCards(cards, { query: 'click citations' }, NOW)).toEqual([]);
  });
  it('narrows by strength, platform and when it was found', () => {
    expect(names(filterCards(cards, { tier: 'STRONG' }, NOW))).toEqual(['Backlink budgets']);
    expect(names(filterCards(cards, { platform: 'reddit' }, NOW))).toEqual(['AI citations']);
    expect(names(filterCards(cards, { since: '7' }, NOW))).toEqual(['AI citations']);
    expect(names(filterCards(cards, { since: '90' }, NOW))).toEqual(['AI citations', 'Zero click']);
  });
  it('sorts', () => {
    expect(names(filterCards(cards, { sort: 'oldest' }, NOW))).toEqual(['Backlink budgets', 'Zero click', 'AI citations']);
    expect(names(filterCards(cards, { sort: 'sources' }, NOW))).toEqual(['AI citations', 'Backlink budgets', 'Zero click']);
    expect(names(filterCards(cards, { sort: 'strongest' }, NOW))).toEqual(['AI citations', 'Backlink budgets', 'Zero click']);
    expect(names(filterCards(cards, { sort: 'name' }, NOW))).toEqual(['AI citations', 'Backlink budgets', 'Zero click']);
  });
  it('ignores saved values the bar does not offer', () => {
    expect(cleanFilters({ query: 7, tier: 'HUGE', platform: 'tiktok', since: '3', sort: 'random' })).toEqual(NO_FILTERS);
    expect(cleanFilters(null)).toEqual(NO_FILTERS);
    expect(activeCount({ ...NO_FILTERS, sort: 'name' })).toBe(0); expect(activeCount({ query: ' a ', tier: 'LOW' })).toBe(2);
  });
  it('offers only the strengths and platforms the trends have', () => {
    expect(filterChoices(cards)).toEqual({ tiers: ['FAST-TRACK', 'STRONG', 'MONITOR'], platforms: ['x', 'linkedin', 'reddit'] });
  });
  it('filters a board column by column', () => {
    const board = { cards, scouting: [], columns: { ready: cards.slice(0, 2), passed: cards.slice(2), archived: [] } };
    const view = filterBoard(board, { since: '90' }, NOW);
    expect(names(view.columns.ready)).toEqual(['AI citations', 'Zero click']); expect(view.columns.passed).toEqual([]); expect(view.cards).toHaveLength(2);
  });
});

describe('movePlan', () => {
  const all = () => true; const none = () => false;
  const live = (stage, extra = {}) => card({ name: 'T', stage, canDecide: true, ...extra });
  const plan = (from, to, extra, can = all) => movePlan(live(from, extra), to, { can });
  it('decides a waiting trend without asking', () => {
    expect(plan('potential', 'approved')).toEqual({ allowed: true, action: { kind: 'decide', decision: 'approved' } });
    expect(plan('potential', 'passed')).toEqual({ allowed: true, action: { kind: 'decide', decision: 'passed' } });
    expect(plan('passed', 'potential')).toEqual({ allowed: true, action: { kind: 'decide', decision: 'pending' } });
    expect(plan('passed', 'approved').action).toEqual({ kind: 'decide', decision: 'approved' });
  });
  it('asks before taking back a yes', () => {
    expect(plan('approved', 'potential')).toMatchObject({ allowed: true, action: { kind: 'decide', decision: 'pending' }, confirm: { id: 'unapprove', title: 'Take back the yes on “T”?' } });
    expect(plan('approved', 'passed')).toMatchObject({ action: { kind: 'decide', decision: 'passed' }, confirm: { id: 'unapprove', confirmLabel: 'Skip it' } });
  });
  it('writes reports from Approved, behind the run’s own cost check', () => {
    expect(plan('approved', 'production')).toEqual({ allowed: true, action: { kind: 'write-reports', runId: 'r' } });
    expect(plan('potential', 'production')).toMatchObject({ allowed: false, reason: expect.stringContaining('Say yes to “T” first') });
  });
  it('archives a finished trend after asking, and brings it back to where it was', () => {
    expect(plan('ready', 'archived', { canDecide: false })).toMatchObject({ allowed: true, action: { kind: 'archive', archived: true }, confirm: { id: 'archive', confirmLabel: 'Archive' } });
    expect(plan('passed', 'archived', { canDecide: false }).allowed).toBe(true);
    expect(plan('passed', 'archived')).toMatchObject({ allowed: false, reason: expect.stringContaining('still being decided') });
    expect(plan('potential', 'archived').allowed).toBe(false);
    expect(plan('archived', 'ready', { homeStage: 'ready', canDecide: false })).toEqual({ allowed: true, action: { kind: 'archive', archived: false } });
    expect(plan('archived', 'passed', { homeStage: 'ready', canDecide: false })).toMatchObject({ allowed: false, reason: expect.stringContaining('archived from Ready') });
  });
  it('explains the moves that cannot be made', () => {
    expect(plan('ready', 'potential', { canDecide: false }).reason).toContain('already written');
    expect(plan('ready', 'production', { canDecide: false }).reason).toContain('make channel assets');
    expect(plan('production', 'ready', { canDecide: false }).reason).toContain('is being written');
    expect(plan('potential', 'ready').reason).toContain('by itself');
    expect(plan('passed', 'potential', { canDecide: false }).reason).toContain('has finished');
    expect(plan('ready', 'ready')).toEqual({ allowed: false, reason: '' });
  });
  it('refuses what the role cannot do', () => {
    expect(plan('potential', 'approved', {}, none).reason).toBe('Your role can’t decide trends.');
    expect(plan('ready', 'archived', { canDecide: false }, none).reason).toBe('Your role can’t archive trends.');
    expect(plan('approved', 'production', {}, (method) => method === 'decideResearchTheme').reason).toBe('Your role can’t write reports.');
  });
  it('remembers which questions not to ask again', () => {
    expect(askAgain([], 'archive')).toBe(true); expect(askAgain(stopAsking(undefined, 'archive'), 'archive')).toBe(false); expect(askAgain(['archive'], 'unapprove')).toBe(true);
    expect(stopAsking(['archive'], 'archive')).toEqual(['archive']);
  });
});

describe('archived trends on the board', () => {
  const theme = (id, name) => ({ id, name, evidenceCount: 6, platforms: ['x'] });
  const board = (archivedThemes) => buildTrendBoard({ programs: [{ id: 'p', name: 'Pulse' }],
    researchRuns: [{ id: 'done', programId: 'p', status: 'succeeded', createdAt: '2026-10-10T10:00:00Z', archivedThemes, discoveredThemes: [theme('a', 'A'), theme('b', 'B'), theme('c', 'C')], themes: [theme('a', 'A'), theme('c', 'C')], reportRunIds: [{ themeId: 'a', runId: 'ra' }, { themeId: 'c', runId: 'rc' }] }],
    contentRuns: [{ id: 'ra', status: 'succeeded' }, { id: 'rc', status: 'running' }], assets: [{ id: 'asset-a', runId: 'ra', deliverableId: 'evidence-report', title: 'Report' }] });
  const at = { at: '2026-11-01T00:00:00Z' };
  it('moves a filed Ready or Skipped trend to Archived and remembers where it came from', () => {
    const made = board({ a: at, b: at, c: at });
    expect(made.columns.archived.map((row) => [row.themeId, row.homeStage])).toEqual([['a', 'ready'], ['b', 'passed']]);
    expect(made.columns.ready).toEqual([]); expect(made.columns.passed).toEqual([]);
    // One still being written is never archived, whatever the record says.
    expect(made.columns.production.map((row) => row.themeId)).toEqual(['c']);
    expect(made.columns.archived[0].reportAssets).toHaveLength(1);
    expect(board(undefined).columns.archived).toEqual([]);
  });
  it('names the stage and offers Bring back', () => {
    const [filed] = board({ a: at }).columns.archived;
    expect(stageIdOf(filed)).toBe('archived');
    expect(stageOf(filed, { can: () => true })).toMatchObject({ label: 'Archived', tone: 'muted', next: { id: 'unarchive', label: 'Bring back' } });
    expect(stageOf(filed, { can: () => false }).next).toBeNull();
  });
});
