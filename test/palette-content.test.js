import { describe, expect, it } from 'vitest';
import { PALETTE_GROUPS, cleanReportTitle, groupPaletteItems, paletteContent, rankPaletteItems } from '../src/renderer/src/palette-content.js';
import { PASSED_STAGE, TREND_STAGES } from '../src/shared/trend-board.js';

// One workspace: a run with a trend waiting for an OK, a run whose approved trend has its two documents, a channel
// kit run (its drafts are channel assets, not reports), a picture, and a run from another workspace.
function studio() {
  return {
    activeWorkspaceId: 'ws-1',
    programs: [{ id: 'p1', workspaceId: 'ws-1', name: 'Weekly listening', query: 'search marketing' }, { id: 'p2', workspaceId: 'ws-2', name: 'Other team' }],
    researchRuns: [
      { id: 'r-wait', workspaceId: 'ws-1', programId: 'p1', status: 'awaiting-review', createdAt: '2026-10-12T10:00:00Z', discoveredThemes: [{ id: 't-wait', name: 'AI search visibility', description: 'Teams ask how to show up in AI answers.', evidenceIds: ['a'], platforms: ['reddit'], matchingKeywords: ['llm citations'] }], decisions: {} },
      { id: 'r-done', workspaceId: 'ws-1', programId: 'p1', status: 'succeeded', createdAt: '2026-10-05T10:00:00Z', discoveredThemes: [{ id: 't-done', name: 'Zero-click results' }], themes: [{ id: 't-done', name: 'Zero-click results' }], reportRunIds: [{ themeId: 't-done', runId: 'c-report' }] },
      { id: 'r-other', workspaceId: 'ws-2', programId: 'p2', status: 'awaiting-review', createdAt: '2026-10-12T10:00:00Z', discoveredThemes: [{ id: 't-other', name: 'Not ours' }], decisions: {} },
    ],
    contentRuns: [
      { id: 'c-report', workspaceId: 'ws-1', status: 'succeeded', themeId: 't-done' },
      { id: 'c-kit', workspaceId: 'ws-1', status: 'succeeded', kit: { sourceKey: 'k1' } },
      { id: 'c-draft', workspaceId: 'ws-1', status: 'succeeded' },
    ],
    assets: [
      { id: 'a-evidence', workspaceId: 'ws-1', runId: 'c-report', deliverableId: 'evidence-report', kind: 'text', title: 'Zero-click results — Comprehensive Trends Report', createdAt: '2026-10-06T10:00:00Z' },
      { id: 'a-toolkit', workspaceId: 'ws-1', runId: 'c-report', deliverableId: 'editorial-toolkit', kind: 'text', title: 'TREND: Zero-click results', createdAt: '2026-10-06T10:00:00Z' },
      { id: 'a-kit', workspaceId: 'ws-1', runId: 'c-kit', deliverableId: 'blog', kind: 'text', title: 'Blog post', createdAt: '2026-10-07T10:00:00Z' },
      { id: 'a-draft', workspaceId: 'ws-1', runId: 'c-draft', deliverableId: 'newsletter', channel: 'Email', kind: 'text', title: 'October newsletter', createdAt: '2026-10-08T10:00:00Z' },
      { id: 'a-picture', workspaceId: 'ws-1', runId: 'c-draft', kind: 'image', title: 'Hero', createdAt: '2026-10-08T10:00:00Z' },
    ],
  };
}

describe('palette content', () => {
  it('lists waiting trends, one report entry per trend, other reports and programs, for this workspace only', () => {
    const items = paletteContent({ studio: studio(), canStartResearch: true });
    expect(items.map((item) => item.label)).toEqual(['Review: AI search visibility', 'Read: Zero-click results', 'Read: October newsletter', 'Find new trends with Weekly listening']);
    expect(items.map((item) => item.group)).toEqual([PALETTE_GROUPS.trends, PALETTE_GROUPS.reports, PALETTE_GROUPS.reports, PALETTE_GROUPS.programs]);
    const read = items.find((item) => item.id === 'read:r-done:t-done');
    // The pair shares one content run; the entry opens the trends report and names both documents.
    expect(read.args).toEqual({ assetId: 'a-evidence', assetIds: ['a-evidence', 'a-toolkit'], trend: 'Zero-click results' });
    expect(read.hint).toMatch(/^Trends report \+ Editorial toolkit/);
    expect(items.find((item) => item.action === 'review-trend').args).toEqual({ key: 'r-wait:t-wait', runId: 'r-wait', themeId: 't-wait', name: 'AI search visibility' });
  });

  it('offers research only to people who can start it', () => {
    expect(paletteContent({ studio: studio() }).some((item) => item.action === 'start-research')).toBe(false);
  });

  it('handles an empty studio', () => {
    expect(paletteContent({ studio: {} })).toEqual([]);
    expect(paletteContent()).toEqual([]);
  });

  it('cleans report titles down to the trend name', () => {
    expect(cleanReportTitle('TREND: Zero-click results')).toBe('Zero-click results');
    expect(cleanReportTitle('Zero-click results — Comprehensive Trends Report')).toBe('Zero-click results');
    expect(cleanReportTitle('')).toBe('');
  });
});

describe('palette search', () => {
  const items = [
    { id: 'pages', label: 'Open Datasets', group: 'Pages', keywords: 'data tools analyze' },
    { id: 'read', label: 'Read: AI search visibility', group: 'Reports', keywords: 'trends report editorial toolkit' },
    { id: 'review', label: 'Review: Search intent shifts', group: 'Trends', keywords: ['trend', 'review'] },
    { id: 'tool', label: 'Open Search platforms', group: 'Pages', keywords: 'collect' },
  ];

  it('keeps every item, in order, when nothing is typed', () => {
    expect(rankPaletteItems(items, '  ')).toEqual(items);
  });

  it('needs every word in the label or keywords, and ranks a label that starts a word with the phrase first', () => {
    expect(rankPaletteItems(items, 'search').map((item) => item.id)).toEqual(['read', 'review', 'tool']);
    // A label match beats a keyword-only match, whatever the order.
    expect(rankPaletteItems([{ id: 'keyword', label: 'Open Activity', keywords: 'runs' }, { id: 'label', label: 'Open runs list' }], 'runs').map((item) => item.id)).toEqual(['label', 'keyword']);
    expect(rankPaletteItems(items, 'AI SEARCH').map((item) => item.id)).toEqual(['read']);
    expect(rankPaletteItems(items, 'toolkit').map((item) => item.id)).toEqual(['read']);
    expect(rankPaletteItems(items, 'analyze datasets').map((item) => item.id)).toEqual(['pages']);
    expect(rankPaletteItems(items, 'nothing like this')).toEqual([]);
  });

  it('groups results in the order their first item appears, capped per group', () => {
    const groups = groupPaletteItems(items, 1);
    expect(groups.map((group) => [group.group, group.items.map((item) => item.id)])).toEqual([['Pages', ['pages']], ['Reports', ['read']], ['Trends', ['review']]]);
    expect(groupPaletteItems(items).find((group) => group.group === 'Pages').items).toHaveLength(2);
    expect(groupPaletteItems([{ id: 'x', label: 'Ungrouped' }])).toEqual([{ group: '', items: [{ id: 'x', label: 'Ungrouped' }] }]);
  });
});

describe('trend stage vocabulary', () => {
  it('uses the same stage words as Simple, and says what comes next in an empty column', () => {
    expect([...TREND_STAGES, PASSED_STAGE].map((stage) => stage.label)).toEqual(['Needs your OK', 'Approved', 'Being written', 'Ready', 'Skipped']);
    for (const stage of [...TREND_STAGES, PASSED_STAGE]) expect(stage.empty).toMatch(/\S/);
  });
});
