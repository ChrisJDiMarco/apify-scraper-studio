// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import roles from '../src/main/roles.js';
import fixture from './fixtures/roles-state.js';

// Leftovers from the logic sweep, through the real App: Create content shows a handed-over report as an attached report
// (and sends what the person edited), New › Content from a report opens on the report picker in either layout, and
// Advanced Home's Yes and Skip show at once with Undo, as Simple's do.
const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key), clear: () => stored.clear() } });
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } window.history.replaceState(null, '', '/'); });

const GREETING = /^This week in/;
const h1 = async (name) => (await screen.findAllByRole('heading', { level: 1, name }))[0];
const side = (id) => fireEvent.click(document.querySelector(`[data-spot="nav.${id}"]`));
const admins = [{ id: 'member-chris', name: 'Chris' }];
const identity = { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' };
function openStudio({ uiMode = 'classic', api: extra = {} } = {}) {
  const server = { prefs: { uiMode, welcomedAt: '' }, base: fixture.baseState() };
  const project = () => roles.projectState(server.base, roles.buildViewer({ identity, session: { viewAs: null }, prefs: server.prefs, editionId: 'semrush', web: false, admins }), { adoptions: fixture.adoptions(), admins, memberCount: 5, editionId: 'semrush' });
  const api = {
    appMeta: vi.fn(async () => ({ version: '0.3.0' })), state: vi.fn(async () => project()), onStateChanged: vi.fn(() => () => {}),
    readDataset: vi.fn(async () => ({ items: [] })), contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [{ id: 'social', label: 'Social posts', kind: 'text', channel: 'Social', sections: [] }] })), listHelpImages: vi.fn(async () => []),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId, title: 'AI Overviews eat clicks — Comprehensive Trends Report' }, markdown: `# Report ${assetId}\n\nOriginal text.`, evidence: [{ id: 'e1', text: 'A post.' }] })),
    setViewPrefs: vi.fn(async (patch) => { server.prefs = { ...server.prefs, ...patch }; return { viewer: project().viewer }; }),
    saveSettings: vi.fn(async () => true), decideResearchTheme: vi.fn(async () => true), getTeam: vi.fn(async () => ({ members: [], channels: [], signIn: { web: false } })),
    getTrendAnalytics: vi.fn(async () => null), selectContentWorkspace: vi.fn(async () => true), openSourceUrl: vi.fn(async () => true), listPrompts: vi.fn(async () => ({ prompts: [], groups: [] })),
    createContentRun: vi.fn(async () => ({ id: 'content-new', status: 'queued' })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  return { api, server };
}
const readyTrendButton = () => {
  const ready = [...document.querySelectorAll('.tb-card')].filter((node) => node.getAttribute('aria-label') === 'AI Overviews eat clicks' && within(node).queryByRole('button', { name: /^Create (more )?content$/ }));
  expect(ready.length).toBeGreaterThan(0);
  return within(ready[0]).getByRole('button', { name: /^Create (more )?content$/ });
};

describe('Create content keeps a handed-over report as an attached report', () => {
  it('Advanced Trend board › Create content on a ready trend shows that report’s title and text as an attached report', async () => {
    const { api } = openStudio();
    await h1(GREETING);
    side('board');
    await h1('Trend board');
    fireEvent.click(readyTrendButton());
    await h1('Create content');
    await waitFor(() => expect(api.readStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-aio-report-2' }));
    const attached = await screen.findByRole('group', { name: 'Attached report: AI Overviews eat clicks — Comprehensive Trends Report' });
    expect(within(attached).getByText('From a trends report')).toBeInTheDocument();
    expect(within(attached).getByText(/1 source records stay attached/)).toBeInTheDocument();
    expect(within(attached).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Source title')).toHaveValue('AI Overviews eat clicks — Comprehensive Trends Report');
    expect(document.getElementById('cs-source-text').value).toContain('Original text.');
    expect(screen.getByRole('button', { name: /Use a report/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the brief the person edited, with the report still attached', async () => {
    const { api } = openStudio();
    await h1(GREETING);
    side('board');
    await h1('Trend board');
    fireEvent.click(readyTrendButton());
    await screen.findByRole('group', { name: /^Attached report:/ });
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Clicks are leaving' } });
    fireEvent.change(document.getElementById('cs-source-text'), { target: { value: 'My shorter brief.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose deliverables' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Social posts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review generation' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true); // the paid-work confirmation
    fireEvent.click(screen.getByRole('button', { name: /^Generate drafts/ }));
    await waitFor(() => expect(api.createContentRun).toHaveBeenCalled());
    expect(api.createContentRun.mock.calls[0][0].source).toMatchObject({ kind: 'report', id: 'asset-aio-report-2', title: 'Clicks are leaving', text: 'My shorter brief.' });
  });

  it('Remove takes the report away and leaves a blank brief', async () => {
    openStudio();
    await h1(GREETING);
    side('board');
    await h1('Trend board');
    fireEvent.click(readyTrendButton());
    const attached = await screen.findByRole('group', { name: /^Attached report:/ });
    fireEvent.click(within(attached).getByRole('button', { name: /Remove/ }));
    expect(screen.queryByRole('group', { name: /^Attached report:/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Source title')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Paste a brief/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('New › Content from a report', () => {
  it('opens Create content on the report picker in the Advanced layout, not the paste form', async () => {
    openStudio();
    await h1(GREETING);
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Content from a report/ }));
    await h1('Create content');
    expect(screen.getByRole('button', { name: /Use a report/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Paste a brief/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByLabelText('Source title')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /AI Overviews eat clicks — Comprehensive Trends Report/ }).length).toBeGreaterThan(0);
  });
  it('opens Create content on the report picker from Simple too', async () => {
    openStudio({ uiMode: 'simple' });
    await h1(GREETING);
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Content from a report/ }));
    await h1('Create content');
    expect(screen.getByRole('button', { name: /Use a report/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Source title')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /AI Overviews eat clicks — Comprehensive Trends Report/ }).length).toBeGreaterThan(0);
  });
});

describe('Advanced Home’s Yes and Skip', () => {
  it('update at once and can be taken back with Undo', async () => {
    let release;
    const decideResearchTheme = vi.fn((payload) => (payload.decision === 'pending' ? Promise.resolve(true) : new Promise((resolve) => { release = () => resolve(true); })));
    const { api } = openStudio({ api: { decideResearchTheme } });
    await h1(GREETING);
    const needs = await screen.findByRole('region', { name: /Needs your OK/ });
    const TREND = 'AI Overviews eat clicks';
    expect(within(needs).getByRole('button', { name: TREND })).toBeInTheDocument();
    fireEvent.click(within(needs).getByRole('button', { name: `Skip ${TREND}` }));
    // Shown at once, before the save comes back.
    await waitFor(() => expect(within(screen.getByRole('region', { name: /Needs your OK/ })).queryByRole('button', { name: TREND })).not.toBeInTheDocument());
    expect(api.decideResearchTheme).toHaveBeenCalledWith(expect.objectContaining({ runId: 'research-review', themeId: 'theme-aio', decision: 'passed' }));
    release();
    const toast = await screen.findByText(`Skipped “${TREND}”.`);
    fireEvent.click(within(toast.closest('.studio-toast')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.decideResearchTheme).toHaveBeenLastCalledWith(expect.objectContaining({ runId: 'research-review', themeId: 'theme-aio', decision: 'pending' })));
    await waitFor(() => expect(within(screen.getByRole('region', { name: /Needs your OK/ })).getByRole('button', { name: TREND })).toBeInTheDocument());
  });
});
