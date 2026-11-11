import { describe, expect, it } from 'vitest';
import { buildTrendBoard } from '../src/shared/trend-board.js';
import { STAGE_LABELS, TREND_STAGE_IDS, cardForTheme, reportOf, stageCounts, stageIdOf, stageOf } from '../src/renderer/src/trend-stage.js';

const yes = () => true;
const no = () => false;
const only = (...methods) => (method) => methods.includes(method);
const theme = (id, name) => ({ id, name, evidenceCount: 6, platforms: ['x'] });

// One research run under review (a waiting trend, an approved one, a skipped one) and finished runs whose trends are
// being written, stopped, ready with no assets, having assets made, and ready with assets.
function board() {
  return buildTrendBoard({
    programs: [{ id: 'p', name: 'AI search pulse' }],
    researchRuns: [
      { id: 'review', programId: 'p', status: 'awaiting-review', createdAt: '2026-10-15T10:00:00.000Z', discoveredThemes: [theme('wait', 'Zero click'), theme('yes', 'Agentic checkout'), theme('no', 'Old news')], decisions: { yes: 'approved', no: 'passed' } },
      { id: 'done', programId: 'p', status: 'succeeded', createdAt: '2026-10-10T10:00:00.000Z',
        discoveredThemes: [theme('writing', 'A'), theme('stuck', 'B'), theme('ready', 'C'), theme('making', 'D'), theme('made', 'E'), theme('dropped', 'F')],
        themes: [theme('writing', 'A'), theme('stuck', 'B'), theme('ready', 'C'), theme('making', 'D'), theme('made', 'E')],
        reportRunIds: [{ themeId: 'writing', runId: 'r-writing' }, { themeId: 'stuck', runId: 'r-stuck' }, { themeId: 'ready', runId: 'r-ready' }, { themeId: 'making', runId: 'r-making' }, { themeId: 'made', runId: 'r-made' }] },
    ],
    contentRuns: [
      { id: 'r-writing', status: 'running' }, { id: 'r-stuck', status: 'failed' }, { id: 'r-ready', status: 'succeeded' }, { id: 'r-making', status: 'succeeded' }, { id: 'r-made', status: 'succeeded' },
      { id: 'kit-making', status: 'running', sourceAssetId: 'a-making' }, { id: 'kit-made', status: 'succeeded', sourceAssetId: 'a-made' },
    ],
    assets: [
      { id: 'a-ready-kit', runId: 'r-ready', deliverableId: 'editorial-toolkit', title: 'Toolkit' }, { id: 'a-ready', runId: 'r-ready', deliverableId: 'evidence-report', title: 'Report' },
      { id: 'a-making', runId: 'r-making', deliverableId: 'evidence-report', title: 'Report' }, { id: 'a-made', runId: 'r-made', deliverableId: 'evidence-report', title: 'Report' },
      { id: 'post-1', runId: 'kit-made', deliverableId: 'linkedin-post' }, { id: 'post-2', runId: 'kit-made', deliverableId: 'blog' },
    ],
  });
}
const card = (themeId) => board().cards.find((row) => row.themeId === themeId);

describe('stageIdOf', () => {
  it('names every board card with one stage', () => {
    expect(Object.fromEntries(board().cards.map((row) => [row.themeId, stageIdOf(row)]))).toEqual({
      wait: 'needs-ok', yes: 'approved', no: 'skipped', writing: 'writing', stuck: 'attention', ready: 'report-ready', making: 'making-assets', made: 'assets-ready', dropped: 'skipped',
    });
  });
  it('has a label for every stage', () => {
    for (const id of TREND_STAGE_IDS) expect(STAGE_LABELS[id]).toBeTruthy();
  });
});

describe('stageOf', () => {
  it('offers one next step per stage to someone who can do everything', () => {
    const next = (themeId) => stageOf(card(themeId), { can: yes }).next;
    expect(next('wait')).toEqual({ id: 'decide', label: 'Approve' });
    expect(next('yes')).toEqual({ id: 'write-reports', runId: 'review', label: 'Write reports' });
    expect(next('writing')).toBeNull();
    expect(next('stuck')).toEqual({ id: 'retry', runId: 'r-stuck', label: 'Try again' });
    expect(next('ready')).toEqual({ id: 'make-assets', assetId: 'a-ready', label: 'Make channel assets' });
    expect(next('making')).toEqual({ id: 'open-assets', label: 'See progress' });
    expect(next('made')).toEqual({ id: 'open-assets', label: 'Open channel assets' });
    expect(next('no')).toEqual({ id: 'restore', label: 'Bring back' });
  });
  it('leaves out a step the role cannot take', () => {
    for (const themeId of ['wait', 'yes', 'stuck', 'ready', 'no']) expect(stageOf(card(themeId), { can: no }).next).toBeNull();
    expect(stageOf(card('yes'), { can: only('approveResearchThemes') }).next).toBeNull();
    expect(stageOf(card('ready'), { can: only('planAssetKit') }).next).toBeNull();
  });
  it('does not offer to bring back a trend whose run has moved on', () => {
    expect(stageOf(card('dropped'), { can: yes }).next).toBeNull();
  });
  it('says what is happening while the studio works', () => {
    expect(stageOf(card('writing'), { can: yes })).toMatchObject({ label: 'Writing reports', tone: 'working', detail: 'Writing reports' });
    expect(stageOf(card('made'), { can: yes }).detail).toBe('2 assets made.');
  });
});

describe('reportOf', () => {
  it('prefers the trends report over the toolkit', () => {
    expect(reportOf(card('ready')).id).toBe('a-ready');
    expect(reportOf(card('wait'))).toBeNull();
  });
});

describe('stageCounts', () => {
  it('lists the stages that have trends, in pipeline order', () => {
    expect(stageCounts(board().cards).map((row) => [row.id, row.count])).toEqual([['needs-ok', 1], ['approved', 1], ['writing', 1], ['report-ready', 1], ['making-assets', 1], ['assets-ready', 1], ['attention', 1], ['skipped', 2]]);
  });
});

describe('cardForTheme', () => {
  const cards = [
    { themeId: 't', runId: 'old', stage: 'ready', reportAssets: [{ id: 'a' }], discoveredAt: '2026-10-01' },
    { themeId: 't', runId: 'new', stage: 'production', discoveredAt: '2026-10-09' },
    { themeId: 'u', runId: 'new', stage: 'ready', reportAssets: [{ id: 'b' }], discoveredAt: '2026-10-09' },
  ];
  it('opens the newest card with reports', () => {
    expect(cardForTheme(cards, 't').runId).toBe('old');
  });
  it('opens a card waiting for a decision first', () => {
    expect(cardForTheme([...cards, { themeId: 't', runId: 'review', stage: 'potential', discoveredAt: '2026-09-01' }], 't').runId).toBe('review');
  });
  it('opens the run it is asked for, and nothing for an unknown trend', () => {
    expect(cardForTheme(cards, 't', 'new').runId).toBe('new');
    expect(cardForTheme(cards, 'missing')).toBeNull();
  });
});
