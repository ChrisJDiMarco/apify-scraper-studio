// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleMode, askIntro, startersFor } from '../src/renderer/src/simple-mode.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';
import { forgetTrendPosts } from '../src/renderer/src/trend-pulse.jsx';

// A plain in-memory Storage: the test runner's Node can leave window.localStorage undefined.
function memoryStorage() { const rows = new Map(); return { getItem: (key) => (rows.has(key) ? rows.get(key) : null), setItem: (key, value) => rows.set(key, String(value)), removeItem: (key) => rows.delete(key), clear: () => rows.clear() }; }
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true, writable: true }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); forgetTrendPosts(); });

const theme = (id, name) => ({ id, name, evidenceCount: 5, platforms: ['x'] });
function studio(runs) {
  return { activeWorkspaceId: 'ws', workspaces: [{ id: 'ws', name: 'Semrush workspace', editionId: 'semrush' }], programs: [{ id: 'p', workspaceId: 'ws', name: 'AI search pulse' }], researchRuns: runs, contentRuns: [], assets: [], themes: [] };
}
function api(extra = {}) {
  return { decideResearchTheme: vi.fn(async () => ({})), retryStudioRun: vi.fn(async () => ({ id: 'broken' })), readTrendHistory: vi.fn(async () => null), ...extra };
}
const admin = { id: 'member-alex', name: 'Alex', role: 'admin', base: 'admin', allowed: null, prefs: {} };
function trends({ runs, services = api(), viewer = admin } = {}) {
  const action = vi.fn(async (work) => work());
  const view = render(<ViewerContext.Provider value={viewer}><SimpleMode api={services} state={{ keys: { APIFY_API_TOKEN: true }, contentStudio: studio(runs) }} action={action} tab="trends" onTab={vi.fn()} tabs={['home', 'trends', 'reports', 'assets']} /></ViewerContext.Provider>);
  return { services, view };
}

describe('Simple Trends', () => {
  it('says a research run stopped, with Try again, instead of “all caught up”', async () => {
    const broken = { id: 'broken', workspaceId: 'ws', programId: 'p', title: 'AI search pulse', status: 'failed', message: 'The app stopped during this run.', createdAt: '2026-10-15T10:00:00Z', maxBudgetUsd: 25 };
    const { services } = trends({ runs: [broken] });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // it stays for days, so it isn't read out on every visit
    const alert = screen.getAllByRole('status').find((row) => row.textContent.includes('Research stopped'));
    expect(alert).toHaveTextContent('Research stopped · AI search pulse');
    expect(alert).toHaveTextContent('The app stopped during this run.');
    expect(screen.queryByText('You’re all caught up')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(services.retryStudioRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'broken' })));
  });

  it('takes back a Skip with Undo in the toast, and keeps skipped trends reachable with Reconsider', async () => {
    const review = { id: 'r', workspaceId: 'ws', programId: 'p', status: 'awaiting-review', createdAt: '2026-10-15T10:00:00Z', discoveredThemes: [theme('t-1', 'Agentic checkout'), theme('t-2', 'Zero click')], decisions: { 't-2': 'passed' } };
    const { services } = trends({ runs: [review] });
    fireEvent.click(screen.getByRole('button', { name: 'Skip Agentic checkout' }));
    await waitFor(() => expect(services.decideResearchTheme).toHaveBeenCalledWith({ runId: 'r', themeId: 't-1', decision: 'passed' }));
    const toast = (await screen.findByText('Skipped “Agentic checkout”.')).closest('.studio-toast');
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(services.decideResearchTheme).toHaveBeenLastCalledWith({ runId: 'r', themeId: 't-1', decision: 'pending' }));
    // The trend skipped earlier is under Skipped, with Reconsider.
    fireEvent.click(screen.getByText('Skipped', { selector: 'summary, summary *' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reconsider Zero click' }));
    await waitFor(() => expect(services.decideResearchTheme).toHaveBeenLastCalledWith({ runId: 'r', themeId: 't-2', decision: 'pending' }));
  });

  it('remembers List or Board for each person on this device', () => {
    const review = { id: 'r', workspaceId: 'ws', programId: 'p', status: 'awaiting-review', createdAt: '2026-10-15T10:00:00Z', discoveredThemes: [theme('t-1', 'Agentic checkout')], decisions: {} };
    const first = trends({ runs: [review] });
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    first.view.unmount();
    trends({ runs: [review] });
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    trends({ runs: [review], viewer: { ...admin, id: 'member-sam', name: 'Sam' } });
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows two real posts on a trend that needs an OK, free, and says so in place when they can’t be read', async () => {
    const review = { id: 'r', workspaceId: 'ws', programId: 'p', status: 'awaiting-review', createdAt: '2026-10-15T10:00:00Z', discoveredThemes: [theme('t-1', 'Agentic checkout'), theme('t-2', 'Zero click')], decisions: {} };
    const readTrendPosts = vi.fn(async ({ themeId }) => (themeId === 't-1' ? { posts: [{ platform: 'x', author: 'Riley', text: 'Checkout agents are buying for people now.', url: 'https://x.com/riley/status/1', engagement: 120 }] } : Promise.reject(new Error('Not found'))));
    trends({ runs: [review], services: api({ readTrendPosts }) });
    const [first, second] = screen.getAllByRole('button', { name: /Show 2 real posts/ });
    fireEvent.click(first);
    expect(await screen.findByText('Checkout agents are buying for people now.')).toBeInTheDocument();
    expect(readTrendPosts).toHaveBeenCalledWith({ themeId: 't-1', name: 'Agentic checkout', limit: 2 });
    fireEvent.click(second);
    await waitFor(() => expect(readTrendPosts).toHaveBeenCalledTimes(2));
    // The button that has focus stays, and the panel says what happened; closing and opening it asks again.
    expect(await screen.findByText('The posts couldn’t be read. Close this and try again.')).toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('button', { name: /Show 2 real posts|Hide the posts/ })).toHaveLength(2);
    fireEvent.click(second); fireEvent.click(second);
    await waitFor(() => expect(readTrendPosts).toHaveBeenCalledTimes(3));
  });
});

describe('Ask AI starters and intro follow the role', () => {
  const all = () => true;
  const only = (...methods) => (method) => methods.includes(method);
  it('offers only what the role can do, and what is true now', () => {
    const editor = startersFor(only('decideResearchTheme', 'readTrendHistory', 'readStudioRun', 'approveResearchThemes', 'continueResearchRun'), { waiting: 2, approved: 1 });
    expect(editor.slice(0, 2)).toEqual(['Which trends still need my OK?', 'Write the reports for my approved trends']);
    expect(editor).not.toContain('Make every channel asset for my latest trend');
    const analyst = startersFor(only('readTrendHistory', 'readStudioRun'), { waiting: 3, reports: 2 });
    expect(analyst).not.toContain('Which trends still need my OK?');
    expect(analyst).toContain('What changed since my last research run?');
    expect(startersFor(all, { admin: true, imagesReady: false, latestTrend: 'Zero click', reports: 1 })).toContain('Show me where to turn on pictures');
    expect(startersFor(all, { admin: false, imagesReady: true, latestTrend: 'Zero click', reports: 1 })).toEqual(expect.arrayContaining(['Quick scan: what’s new on “Zero click” in the last 6 hours?', 'Make every channel asset for my latest trend']));
    expect(startersFor(all, {}).length).toBeLessThanOrEqual(6);
  });
  it('says what it can see and do for this role', () => {
    expect(askIntro(only('readStudioRun', 'readStudioAsset'))).toMatch(/^I can see your trends and how they move across runs and your reports and asset folders, and I can read any report\. Ask a question, or say “show me”/);
    expect(askIntro(() => true, { admin: true })).toContain('tell me what to do (I’ll offer a button, so nothing happens until you click), ask for a quick scan of the last few hours');
  });
});
