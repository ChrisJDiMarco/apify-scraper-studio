import { describe, expect, it } from 'vitest';
import cardsLib from '../src/main/monday-cards.js';
import { buildTrendBoard } from '../src/shared/trend-board.js';

// The server-built Monday cards (src/main/monday-cards.js) keep the Trend board's stage rules (src/shared/trend-board.js).
const { buildMondayCards, fieldValues, diff, milestones } = cardsLib;
const theme = (id, name, extra = {}) => ({ id, name, description: `${name} described.`, evidenceIds: ['a', 'b'], platforms: ['x'], scoring: { priorityTier: 'STRONG', taxonomy: { category: 'AI search' } }, ...extra });
const STATE = {
  programs: [{ id: 'p1', name: 'Weekly pulse' }],
  researchRuns: [
    { id: 'r1', programId: 'p1', status: 'awaiting-review', createdAt: '2026-10-10T10:00:00Z', discoveredThemes: [theme('t1', 'Zero-click search'), theme('t2', 'AI Overviews'), theme('t3', 'Agent browsers')], decisions: { t1: 'approved', t2: 'passed' }, decisionsBy: { t1: { id: 'm1', name: 'Dana Lee', at: '2026-10-11T09:00:00Z', note: 'Great for Blog' } } },
    { id: 'r2', programId: 'p1', status: 'succeeded', approvedAt: 'x', createdAt: '2026-10-01T10:00:00Z', discoveredThemes: [theme('t4', 'Ready trend'), theme('t5', 'Writing trend'), theme('t6', 'Skipped trend'), theme('t7', 'Assets trend')], themes: [theme('t4', 'Ready trend'), theme('t5', 'Writing trend'), theme('t7', 'Assets trend')], reportRunIds: [{ themeId: 't4', runId: 'c4' }, { themeId: 't5', runId: 'c5' }, { themeId: 't7', runId: 'c7' }] },
    { id: 'quick', programId: 'p1', origin: 'quick-scan', status: 'succeeded', createdAt: '2026-10-12T10:00:00Z', discoveredThemes: [theme('q1', 'Quick pulse')], themes: [theme('q1', 'Quick pulse')] },
    { id: 'gone', programId: 'p1', status: 'cancelled', createdAt: '2026-09-01T10:00:00Z', discoveredThemes: [theme('g1', 'Cancelled')] },
    { id: 'old', programId: 'p1', status: 'failed', createdAt: '2026-08-01T10:00:00Z', themes: [] },
  ],
  contentRuns: [{ id: 'c4', status: 'succeeded' }, { id: 'c5', status: 'running' }, { id: 'c7', status: 'succeeded' }, { id: 'kit', status: 'running', sourceAssetId: 'a7' }],
  assets: [{ id: 'a4', runId: 'c4', deliverableId: 'evidence-report' }, { id: 'a4t', runId: 'c4', deliverableId: 'editorial-toolkit' }, { id: 'a7', runId: 'c7', deliverableId: 'evidence-report' }],
};

describe('Monday cards built on the server', () => {
  it('match the Trend board’s keys and stages (quick scans, cancelled runs and assets being made included)', () => {
    const board = buildTrendBoard(STATE).cards.map((card) => [card.key, card.stage]).sort();
    const monday = buildMondayCards(STATE).map((card) => [card.key, card.stage]).sort();
    expect(monday).toEqual(board);
    expect(Object.fromEntries(monday)).toMatchObject({ 'r1:t1': 'approved', 'r1:t2': 'passed', 'r1:t3': 'potential', 'r2:t4': 'ready', 'r2:t5': 'production', 'r2:t6': 'passed', 'r2:t7': 'production' });
    expect(monday.some(([key]) => key.startsWith('quick:') || key.startsWith('gone:'))).toBe(false);
  });

  it('links a delivered Google Doc first, then the studio deep link', () => {
    const cards = buildMondayCards({ ...STATE, origin: 'https://studio.example.com/', docLinks: { a4: 'https://docs.google.com/document/d/abc' } });
    const ready = cards.find((card) => card.key === 'r2:t4');
    expect(ready.reportUrl).toBe('https://docs.google.com/document/d/abc');
    expect(ready.toolkitUrl).toBe('https://studio.example.com/#/report/a4t');
    expect(ready.studioUrl).toBe('https://studio.example.com/#/trend/t4');
    expect(buildMondayCards(STATE).find((card) => card.key === 'r2:t4').toolkitUrl).toBe(''); // no address known: no link
  });

  it('summarises channel answers with the earliest planned date', () => {
    const adoptions = [
      { themeId: 't1', channelId: 'blog', status: 'using', plannedFor: '2099-10-24', link: 'https://blog.example.com/draft', by: { name: 'Sam' } },
      { themeId: 't1', channelId: 'pr', status: 'not-using', by: { name: 'Ava' } },
      { themeId: 't1', channelId: 'social', status: 'using', plannedFor: '2099-10-20' },
    ];
    const card = buildMondayCards({ ...STATE, adoptions, editionId: 'semrush' }).find((row) => row.key === 'r1:t1');
    expect(card.plannedFor).toBe('2099-10-20');
    const link = { columns: { channels: 'ch', notes: 'n', decidedBy: 'd', stage: 's' }, columnInfo: { ch: { type: 'long_text' }, n: { type: 'long_text' }, d: { type: 'text' }, s: { type: 'status' } } };
    const values = fieldValues(card, link);
    expect(values.channels).toContain('Semrush Blog: using · Oct 24 · https://blog.example.com/draft');
    expect(values.channels).toContain('Semrush PR: not for us');
    expect(values.decidedBy).toBe('Dana Lee · Yes · Oct 11');
    expect(values.stage).toBe('Approved');
    expect(values.notes).toContain('Note for the channels: Great for Blog');
    expect(milestones(card).map((entry) => entry.id)).toEqual(['approved', 'adoption:blog:using', 'adoption:pr:not-using', 'adoption:social:using']);
  });

  it('sends trends from now on only, and leaves skipped trends out when asked', () => {
    const fromNow = buildMondayCards({ ...STATE, from: 'now', linkedAt: '2026-10-05T00:00:00Z' });
    expect(new Set(fromNow.map((card) => card.runId))).toEqual(new Set(['r1']));
    const noSkips = buildMondayCards({ ...STATE, includeSkipped: false });
    expect(noSkips.some((card) => card.stage === 'passed')).toBe(false);
  });

  it('hashes each field so only changed columns are sent', () => {
    const card = buildMondayCards(STATE).find((row) => row.key === 'r1:t3');
    const link = { columns: { stage: 's', studioKey: 'k', notes: 'n' }, columnInfo: { s: { type: 'status' }, k: { type: 'text' }, n: { type: 'long_text' } } };
    const types = { name: 'name', stage: 'status', studioKey: 'text', notes: 'long_text' };
    const first = diff(fieldValues(card, link), {}, types);
    expect(Object.keys(first.changed).sort()).toEqual(['name', 'notes', 'stage', 'studioKey']);
    const again = diff(fieldValues(card, link), first.hashes, types);
    expect(again.changed).toEqual({});
    const moved = diff(fieldValues({ ...card, stage: 'approved' }, link), first.hashes, types);
    expect(Object.keys(moved.changed)).toEqual(['stage']);
  });
});
