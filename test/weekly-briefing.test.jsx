// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyBriefing, briefingData, briefingMarkdown, briefingWeek } from '../src/renderer/src/weekly-briefing.jsx';

afterEach(cleanup);
const NOW = new Date(2026, 9, 15, 12); // Thursday, Oct 15 (local)
const iso = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const theme = (id, name) => ({ id, name, evidenceCount: 8, platforms: ['x'] });
function state() {
  return {
    keys: { APIFY_API_TOKEN: true },
    contentStudio: {
      activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }], programs: [{ id: 'p', workspaceId: 'semrush', name: 'AI search pulse' }],
      researchRuns: [
        { id: 'review', workspaceId: 'semrush', programId: 'p', status: 'awaiting-review', createdAt: iso(12), discoveredThemes: [theme('t-1', 'Agentic checkout'), theme('t-2', 'Zero click')], decisions: {} },
        { id: 'done', workspaceId: 'semrush', programId: 'p', status: 'succeeded', createdAt: iso(12, 8), approvedAt: iso(12, 9), discoveredThemes: [theme('t-3', 'AI Overviews')], themes: [theme('t-3', 'AI Overviews')], decisionsBy: { 't-3': { id: 'member-riley', name: 'Riley', at: iso(12, 9), note: 'Lead with the CTR data.', channels: ['social', 'blog'] } }, reportRunIds: [{ themeId: 't-3', runId: 'report' }] },
        { id: 'live', workspaceId: 'semrush', programId: 'p', title: 'AI search pulse', status: 'running', stage: 'collecting', createdAt: iso(15, 9) },
      ],
      contentRuns: [{ id: 'report', workspaceId: 'semrush', status: 'succeeded', themeId: 't-3', researchRunId: 'done', createdAt: iso(13), title: 'AI Overviews' }],
      assets: [{ id: 'asset-report', workspaceId: 'semrush', runId: 'report', deliverableId: 'evidence-report', title: 'AI Overviews — Trends report', createdAt: iso(13, 11) }],
      adoptionsByTheme: { 't-3': { social: { status: 'using', link: 'https://www.linkedin.com/posts/semrush-aio', byName: 'Jordan', at: iso(14), channelName: 'Semrush Social Team' } } },
    },
  };
}
const viewer = { id: 'member-chris', name: 'Chris', role: 'admin', allowed: null, prefs: { focusChannels: ['blog'] } };

describe('weekly briefing', () => {
  it('covers the week since Monday, or the week just gone on a Monday', () => {
    expect(briefingWeek(NOW).start).toEqual(new Date(2026, 9, 12));
    expect(briefingWeek(new Date(2026, 9, 19, 9))).toMatchObject({ start: new Date(2026, 9, 12), lastWeek: true });
  });

  it('gathers what needs an OK, what is ready per channel, what shipped and what is working', () => {
    const data = briefingData({ state: state(), viewer, now: NOW });
    expect(data.waiting.map((card) => card.name)).toEqual(['Agentic checkout', 'Zero click']);
    expect(data.ready.map((row) => [row.card.name, row.routed, row.using.map((channel) => channel.id), row.quiet.map((channel) => channel.id)])).toEqual([['AI Overviews', ['social', 'blog'], ['social'], ['blog']]]);
    expect(data.forYou.map((row) => [row.card.name, row.focus])).toEqual([['AI Overviews', [{ id: 'blog', name: 'Blog', answer: '' }]]]);
    expect(data.shipped).toEqual([expect.objectContaining({ channel: 'Semrush Social Team', title: 'AI Overviews', link: 'https://www.linkedin.com/posts/semrush-aio' })]);
    expect(data.live.map((run) => run.id)).toEqual(['live']);
    expect(briefingMarkdown(data)).toBe([
      '*This week in Semrush workspace* · week of Oct 12',
      '*Needs your OK (2)*\n• Agentic checkout\n• Zero click',
      '*Ready for channels*\n• AI Overviews · Using: Social · No answer: Blog · Note: “Lead with the CTR data.”',
      '*Shipped*\n• Semrush Social Team used “AI Overviews” https://www.linkedin.com/posts/semrush-aio',
      '*Working now*\n• Research run: AI search pulse',
    ].join('\n\n'));
  });

  it('says it is a quiet week when nothing happened', () => {
    const empty = { keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }] } };
    expect(briefingMarkdown(briefingData({ state: empty, viewer, now: NOW }))).toBe('*This week in Semrush workspace* · week of Oct 12\n\nQuiet week so far. New trends show up here after the next research run.');
    render(<WeeklyBriefing state={empty} viewer={viewer} api={{}} now={NOW} onStartResearch={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This week in Semrush workspace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quiet week so far.' })).toBeInTheDocument();
  });

  it('decides a trend in one tap and opens what a row names', () => {
    const onDecide = vi.fn(); const onOpenTarget = vi.fn();
    render(<WeeklyBriefing state={state()} viewer={viewer} api={{}} now={NOW} onDecide={onDecide} onDecideWithNote={vi.fn()} onOpenTarget={onOpenTarget} />);
    const needs = within(screen.getByRole('region', { name: /Needs your OK/ }));
    fireEvent.click(needs.getByRole('button', { name: 'Yes, use it: Agentic checkout' }));
    fireEvent.click(needs.getByRole('button', { name: 'Skip Zero click' }));
    expect(onDecide.mock.calls.map(([card, decision]) => [card.name, decision])).toEqual([['Agentic checkout', 'approved'], ['Zero click', 'passed']]);
    expect(needs.getByRole('button', { name: 'More ways to say yes to Agentic checkout' })).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(within(screen.getByRole('region', { name: /Ready for channels/ })).getByRole('button', { name: 'AI Overviews' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'report', id: 'asset-report', page: 'reports' });
  });
});
