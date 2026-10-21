// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { buildTrendHistory, compactTrend, trendChanges } from '../src/shared/trend-history.js';
import { buildInbox } from '../src/renderer/src/inbox-model.js';
import { WeeklyBriefing } from '../src/renderer/src/weekly-briefing.jsx';
import { HelpAssistant } from '../src/renderer/src/help-assistant.jsx';
import { useStudioActions } from '../src/renderer/src/studio-actions.js';

// Hand-offs in the real App: what a click in one place opens in the next, in the layout the person is using.
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); try { localStorage.clear(); } catch { /* storage can be off */ } });
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); });

const TREND = 'AI Citation Tracking ROI Breakdown';
const FOLDER = `Golden Thread — ${TREND} (2026-10-16)`;
const recent = () => new Date(Date.now() - 60 * 60000).toISOString(); // inside the Inbox's 30 days
const kitRun = { id: 'content-kit', workspaceId: 'semrush', type: 'content', title: TREND, status: 'succeeded', createdAt: '2026-10-16T13:52:00.000Z', maxBudgetUsd: 25, costUsd: 4,
  kit: { sourceKey: 'theme:theme-1', sourceKind: 'trend', sourceTitle: TREND, folderName: FOLDER, reportAssetId: 'asset-report' },
  jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', folder: 'Semrush Blog', status: 'succeeded' }] };
const trendRun = { id: 'content-trend', workspaceId: 'semrush', type: 'content', title: TREND, themeId: 'theme-1', status: 'succeeded', createdAt: '2026-10-10T10:00:00Z', jobs: [] };
const reportPair = [
  { id: 'asset-report', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'evidence-report', kind: 'text', title: `${TREND} — Comprehensive Trends Report`, channel: 'Research', createdAt: '2026-10-10T10:00:00Z' },
  { id: 'asset-toolkit', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'editorial-toolkit', kind: 'text', title: `TREND: ${TREND}`, channel: 'Strategy', createdAt: '2026-10-10T10:00:00Z' },
];
const plan = { title: TREND, sourceKey: 'theme:theme-1', sourceKind: 'trend', characters: 27322, evidenceCount: 19, earlierRuns: 1, imagesReady: true, warnings: [], minutes: 12,
  estimate: { totalUsd: 9.4, capUsd: 25, calls: 1, pictures: 0, modelLabel: 'Claude Fable 5.1' },
  folders: [{ id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', selected: true, available: true }] }] };

async function boot(studio = {}, { classic = false, api: extra = {}, home = true } = {}) {
  const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
  const state = { projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }, settings: { maxItems: 1000, sheets: {}, ...(classic ? { uiMode: 'classic' } : {}) },
    v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {}, ...studio } };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), readHelpImage: vi.fn(async () => ({})),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ markdown: `# Body of ${assetId}\n\nText of ${assetId}.` })), setViewPrefs: vi.fn(async () => ({})), saveSettings: vi.fn(async () => ({})),
    planAssetKit: vi.fn(async () => plan), createAssetKit: vi.fn(async () => kitRun), decideResearchTheme: vi.fn(async () => true), estimateResearchProgram: vi.fn(async () => null),
    askHelp: vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [] })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  if (home) await screen.findByRole('heading', { level: 1, name: /^This week in/ });
  else await waitFor(() => expect(document.querySelector('.simple-main')?.dataset.tab).toBeTruthy());
  return api;
}
const side = (id) => fireEvent.click(document.querySelector(`[data-spot="nav.${id}"]`));
const simpleTab = () => document.querySelector('.simple-main')?.dataset.tab;
const toastText = () => [...document.querySelectorAll('.simple-toast, .studio-toast, .feedback')].map((node) => node.textContent).join(' | ');

describe('Inbox rows for channel assets', () => {
  it('opens the edited or published file’s set in Assets, not an empty Reports', async () => {
    const at = recent();
    const kitFile = { id: 'kit-blog', workspaceId: 'semrush', runId: 'content-kit', deliverableId: 'blogshort', kind: 'text', title: 'AI citations are the new rankings', channel: 'Blog', createdAt: at,
      edited: { at, by: { id: 'member-riley', name: 'Riley' } }, review: { status: 'published', at, by: { id: 'member-riley', name: 'Riley' } } };
    await boot({ contentRuns: [trendRun, kitRun], assets: [...reportPair, kitFile] });
    side('inbox');
    fireEvent.click(await screen.findByRole('button', { name: /Riley edited “AI citations are the new rankings”/ }));
    expect(await screen.findByRole('region', { name: FOLDER })).toBeInTheDocument();
    expect(simpleTab()).toBe('assets');
    expect(document.querySelector('.simple-reader')).toBeNull();

    side('inbox');
    fireEvent.click(await screen.findByRole('button', { name: /Riley published “AI citations are the new rankings”/ }));
    expect(await screen.findByRole('region', { name: FOLDER })).toBeInTheDocument();
    expect(simpleTab()).toBe('assets');

    side('inbox');
    expect(await screen.findByRole('button', { name: /Riley edited “AI citations are the new rankings”/ })).toHaveTextContent('Channel asset'); // not "Draft"
  });

  it('points Drafts ready at a run’s written draft before its pictures, and opens a pictures-only run in Assets', async () => {
    const at = recent();
    const state = { contentStudio: { activeWorkspaceId: 'semrush', researchRuns: [], programs: [],
      contentRuns: [{ id: 'mixed', workspaceId: 'semrush', title: 'Launch', status: 'succeeded', createdAt: at, updatedAt: at }],
      assets: [{ id: 'pic', workspaceId: 'semrush', runId: 'mixed', kind: 'image', title: 'Hero', createdAt: at }, { id: 'copy', workspaceId: 'semrush', runId: 'mixed', kind: 'text', deliverableId: 'bloglong', title: 'Launch post', createdAt: at }] } };
    const row = buildInbox({ state, viewer: { id: 'member-chris' } }).items.find((item) => item.id === 'run:mixed');
    expect(row.target).toEqual({ kind: 'report', id: 'copy', page: 'reports' });

    await boot({ contentRuns: [{ id: 'pics', workspaceId: 'semrush', title: 'Launch visuals', status: 'succeeded', createdAt: at, updatedAt: at, jobs: [] }],
      assets: [{ id: 'pic-1', workspaceId: 'semrush', runId: 'pics', kind: 'image', title: 'Hero 1', createdAt: at }] });
    side('inbox');
    fireEvent.click(await screen.findByRole('button', { name: /Drafts ready · “Launch visuals”/ }));
    await waitFor(() => expect(simpleTab()).toBe('assets'));
  });
});

describe('Reports opens as the list when you come back to it', () => {
  const draft = { id: 'draft-1', workspaceId: 'semrush', runId: 'c1', deliverableId: 'bloglong', kind: 'text', title: 'My draft', createdAt: '2026-10-15T10:00:00Z' };
  const studio = { contentRuns: [{ id: 'c1', workspaceId: 'semrush', status: 'succeeded', title: 'Campaign', createdAt: '2026-10-15T10:00:00Z', jobs: [] }], assets: [draft] };
  const openDraft = async () => { side('reports'); fireEvent.click(await screen.findByRole('button', { name: /My draft/ })); await waitFor(() => expect(document.querySelector('.simple-reader')).not.toBeNull()); };
  const expectList = async () => { expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument(); expect(document.querySelector('.simple-reader')).toBeNull(); };

  it('from Home’s All reports and from the sidebar, but keeps the report for Ask AI', async () => {
    await boot(studio);
    await openDraft();
    side('home');
    await screen.findByRole('heading', { level: 1, name: /^This week in/ });
    fireEvent.click(document.querySelector('[data-spot="home.reports"]')); // Ready for channels › All reports
    await expectList();

    await openDraft();
    side('home');
    await screen.findByRole('heading', { level: 1, name: /^This week in/ });
    side('reports');
    await expectList();

    // A trip to Ask AI keeps the report open (it's Ask AI's context), so coming back resumes it.
    await openDraft();
    fireEvent.click(document.querySelector('[data-spot="nav.ask"]'));
    await waitFor(() => expect(simpleTab()).toBe('ask'));
    side('reports');
    await waitFor(() => expect(document.querySelector('.simple-reader')).not.toBeNull());
  });
});

describe('What changed opens the trend’s newest card', () => {
  const base = { workspaceId: 'semrush', programId: 'p1', reportRunIds: [], counts: { discoveryEligible: 100 } };
  const theme = (id, name, evidenceCount) => ({ id, name, evidenceCount });
  const historyOf = (researchRuns) => { const built = buildTrendHistory({ runs: researchRuns }); return { trends: built.trends.map(compactTrend), changes: trendChanges(built) }; };
  const skippedThenBack = [
    { ...base, id: 'r1', title: 'W1', status: 'succeeded', createdAt: '2026-10-05T00:00:00Z', discoveredThemes: [theme('t-z1', 'Zero click', 5), theme('t-o', 'Other', 10)], themes: [theme('t-o', 'Other', 10)], decisions: { 't-z1': 'passed', 't-o': 'approved' } },
    { ...base, id: 'r2', title: 'W2', status: 'awaiting-review', createdAt: '2026-10-12T00:00:00Z', discoveredThemes: [theme('t-z2', 'Zero click', 20), theme('t-p', 'Pther', 10)] },
  ];

  it('sends the theme id and run of the trend’s newest appearance, not the first one it was seen under', async () => {
    const history = historyOf(skippedThenBack);
    expect(history.changes.rising[0]).toMatchObject({ name: 'Zero click', themeIds: ['t-z1', 't-z2'], latestThemeId: 't-z2', latestRunId: 'r2' });
    const onOpenTarget = vi.fn();
    const state = { keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }], programs: [], researchRuns: skippedThenBack, contentRuns: [], assets: [] } };
    render(<WeeklyBriefing state={state} viewer={{ id: 'member-chris', role: 'admin', allowed: null }} api={{ readTrendHistory: vi.fn(async () => history) }} now={new Date('2026-10-14T12:00:00Z')} onOpenTarget={onOpenTarget} onDecide={vi.fn()} />);
    fireEvent.click(within(await screen.findByRole('article', { name: 'What changed' })).getByRole('button', { name: /Zero click/ }));
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'trend', id: 't-z2', runId: 'r2', page: 'trends' });
  });

  async function openFromWhatChanged(researchRuns) {
    const history = historyOf(researchRuns);
    await boot({ programs: [{ id: 'p1', workspaceId: 'semrush', name: 'Weekly', sourceGroups: [], budgets: {} }], researchRuns }, { api: { readTrendHistory: vi.fn(async () => history) } });
    const changed = await screen.findByRole('article', { name: 'What changed' });
    fireEvent.click(within(changed).getByRole('button', { name: /Zero click/ }));
    await waitFor(() => expect(simpleTab()).toBe('trends'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('lands on this week’s card waiting for an OK, without pointing to a Skipped list', async () => {
    // Last week's run (finished) skipped it under one id; this week's run, waiting for review, found it under another.
    await openFromWhatChanged(skippedThenBack);
    expect([...document.querySelectorAll('[data-spot="trends.card"]')].some((node) => node.dataset.spotItem === 'Zero click')).toBe(true);
    expect(toastText()).not.toMatch(/skipped/i);
  });

  it('says a trend skipped in finished runs can’t be reconsidered, instead of sending you to Skipped', async () => {
    await openFromWhatChanged([
      { ...base, id: 'r1', title: 'W1', status: 'succeeded', createdAt: '2026-10-05T00:00:00Z', discoveredThemes: [theme('t-z', 'Zero click', 20), theme('t-o', 'Other', 10)], themes: [theme('t-o', 'Other', 10)], decisions: { 't-z': 'passed', 't-o': 'approved' } },
      { ...base, id: 'r2', title: 'W2', status: 'succeeded', createdAt: '2026-10-12T00:00:00Z', discoveredThemes: [theme('t-z', 'Zero click', 4), theme('t-o', 'Other', 10)], themes: [theme('t-o', 'Other', 10)], decisions: { 't-z': 'passed', 't-o': 'approved' } },
    ]);
    expect(toastText()).toMatch(/“Zero click” was skipped in a research run that has finished, so it can’t be reconsidered there/);
    expect(toastText()).not.toMatch(/under Skipped/);
  });

  it('opens a share link to the older, skipped card on the card waiting again, with no Skipped note', async () => {
    window.history.replaceState(null, '', '/#/trend/t-z1');
    try {
      await boot({ programs: [{ id: 'p1', workspaceId: 'semrush', name: 'Weekly', sourceGroups: [], budgets: {} }], researchRuns: skippedThenBack }, { api: { readTrendHistory: vi.fn(async () => historyOf(skippedThenBack)) }, home: false });
      await waitFor(() => expect(simpleTab()).toBe('trends'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect([...document.querySelectorAll('[data-spot="trends.card"]')].some((node) => node.dataset.spotItem === 'Zero click')).toBe(true);
      expect(toastText()).not.toMatch(/skipped/i);
    } finally { window.history.replaceState(null, '', '/'); }
  });
});

describe('Make channel assets opens over the page you’re on', () => {
  const studio = { contentRuns: [trendRun, kitRun], assets: reportPair };
  const openReader = async () => { side('reports'); fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${TREND}`) }))[0]); await waitFor(() => expect(document.querySelector('.simple-reader')).not.toBeNull()); };

  it('in Simple, Cancel leaves you on the report, and Make leaves one note with Open folder', async () => {
    const api = await boot(studio);
    await openReader();
    fireEvent.click(await screen.findByRole('button', { name: 'Make channel assets' }));
    let dialog = await screen.findByRole('dialog', { name: 'Check what will be made' });
    expect(simpleTab()).toBe('reports'); // the dialog is over the report, not on Assets
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Check what will be made' })).toBeNull());
    expect(simpleTab()).toBe('reports');
    expect(document.querySelector('.simple-reader')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Make channel assets' }));
    dialog = await screen.findByRole('dialog', { name: 'Check what will be made' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Make 1 asset' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Open folder' })).toBeInTheDocument();
    expect(toastText()).not.toMatch(/fill this folder/); // no second note about a folder that isn't open
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(await screen.findByRole('region', { name: FOLDER })).toBeInTheDocument();
  });

  it('in Advanced, a refused Make says why inside the dialog and can be tried again', async () => {
    const api = await boot(studio, { classic: true, api: { createAssetKit: vi.fn(async () => { throw new Error('The Claude app is not signed in. Sign in, then try again.'); }) } });
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Channel assets/ }));
    const source = await screen.findByRole('dialog', { name: 'Which report should the assets come from?' });
    fireEvent.click(within(source).getByRole('radio', { name: new RegExp(TREND) }));
    fireEvent.click(within(source).getByRole('button', { name: /Next: check what’s made/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Check what will be made' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Make 1 asset' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledOnce());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The Claude app is not signed in. Sign in, then try again.');
    expect(within(dialog).getByText(TREND)).toBeInTheDocument(); // the plan stays
    expect(within(dialog).getByRole('button', { name: 'Make 1 asset' })).toBeEnabled();
    expect(document.querySelector('.feedback')).toBeNull(); // not hidden behind the sheet in the page banner
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make 1 asset' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledTimes(2));
  });

  it('in Advanced, a Make that starts leaves only the toast with Open folder', async () => {
    const api = await boot(studio, { classic: true });
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Channel assets/ }));
    const source = await screen.findByRole('dialog', { name: 'Which report should the assets come from?' });
    fireEvent.click(within(source).getByRole('radio', { name: new RegExp(TREND) }));
    fireEvent.click(within(source).getByRole('button', { name: /Next: check what’s made/ }));
    fireEvent.click(await within(await screen.findByRole('dialog', { name: 'Check what will be made' })).findByRole('button', { name: 'Make 1 asset' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Open folder' })).toBeInTheDocument();
    expect(document.querySelector('.feedback')).toBeNull();
    expect(toastText()).not.toMatch(/fill this folder/);
  });
});

describe('Ask AI page links use Ask AI’s page names', () => {
  async function askInSimple() {
    const askHelp = vi.fn(async () => ({ answer: 'Exports live in [Dataset reports](studio:page/reports).', pages: [{ page: 'dashboard', label: 'Open Collection overview' }], followUps: [], actions: [] }));
    await boot({ contentRuns: [trendRun], assets: reportPair }, { api: { askHelp } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'Where are my dataset exports?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    return screen.findByRole('article', { name: 'Answer' });
  }
  const expectPeek = async (title) => {
    await waitFor(() => expect(document.querySelector('.app-shell')?.dataset.mode).toBe('classic')); // an Advanced peek
    expect(screen.getByRole('region', { name: 'Advanced page' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  };

  it('opens Dataset reports from an in-answer link in Simple, not Simple’s Reports', async () => {
    const answer = await askInSimple();
    fireEvent.click(within(answer).getByRole('button', { name: /^Dataset reports/ }));
    await expectPeek('Dataset reports');
  });

  it('opens the Collection overview from a page button in Simple, not Simple’s Home', async () => {
    const answer = await askInSimple();
    fireEvent.click(within(answer).getByRole('button', { name: /Open Collection overview/ }));
    await expectPeek('Collection overview');
  });

  it('sends page links and Open page buttons through openPage in every layout', async () => {
    const onOpenPage = vi.fn(); const openTarget = vi.fn();
    const api = { askHelp: vi.fn(async () => ({ answer: 'See [Dataset reports](studio:page/reports) and [the report](studio:report/asset-1).', pages: [], followUps: [], actions: [] })) };
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={{ id: 'library', label: 'Library' }} onOpenPage={onOpenPage} nav={{ openTarget }} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question about Golden Thread' }), { target: { value: 'Where are exports?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    const answer = await screen.findByRole('article', { name: 'Answer' });
    fireEvent.click(within(answer).getByRole('button', { name: /^Dataset reports/ }));
    expect(onOpenPage).toHaveBeenCalledWith('reports');
    expect(openTarget).not.toHaveBeenCalled();
    fireEvent.click(within(answer).getByRole('button', { name: /^the report/ }));
    expect(openTarget).toHaveBeenCalledWith({ kind: 'report', id: 'asset-1' }); // items still go through openTarget

    const openPage = vi.fn(); const navTarget = vi.fn();
    const action = async (work) => work();
    const { result } = renderHook(() => useStudioActions({ api: {}, state: { contentStudio: { activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'W', editionId: 'semrush' }], programs: [], researchRuns: [], contentRuns: [], assets: [] } }, action, viewer: { preview: false }, can: () => true, canRun: () => true, confirm: async () => true, nav: { openPage, openTarget: navTarget } }));
    await expect(result.current.runAiAction({ kind: 'open', target: 'reports', params: { type: 'page' } })).resolves.toBe('Opened.');
    expect(openPage).toHaveBeenCalledWith('reports');
    expect(navTarget).not.toHaveBeenCalled();
  });
});
