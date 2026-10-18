// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import workflow from '../src/shared/asset-workflow.json';

const emptyState = () => ({
  projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [],
  keys: {}, settings: { maxItems: 1000, sheets: {}, uiMode: 'classic' },
  v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
});

// The sidebar remembers Data tools and the rail on this device; every test starts from a fresh device.
afterEach(() => { cleanup(); delete window.apifyStudio; try { window.localStorage.clear(); } catch { /* no storage */ } });

async function openApp() {
  window.apifyStudio = {
    appMeta: vi.fn(async () => ({ version: 'test' })),
    state: vi.fn(async () => emptyState()),
    onStateChanged: vi.fn(() => () => {}),
    readDataset: vi.fn(async () => ({ items: [], rawItems: [] })),
  };
  render(<App />);
  // No content studio here, so the Advanced layout opens on the collection overview.
  await screen.findByRole('heading', { name: /Research your market/ });
}

// One Main nav in every layout (studio-sidebar.jsx); names can carry a badge's words, so match the start.
function nav(name) { return within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name }); }
const navLabels = () => within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('button').map((button) => button.querySelector('.sb-text')?.textContent || button.textContent);

describe('workspace navigation', () => {
  it('lists the workspace pages, then Data tools (open where there is no content studio), then Settings', async () => {
    await openApp();
    expect(navLabels()).toEqual(['Content studio', 'Overview', 'Sheets', 'Inbox', 'Calendar', 'Data tools', 'Search platforms', 'Scrapers', 'Import research', 'Brief starters', 'Datasets', 'Dataset reports', 'Compare snapshots', 'Ask your datasets', 'Activity', 'Settings']);
    expect(nav('Data tools')).toHaveAttribute('aria-expanded', 'true');
    // Search and Ask AI moved from the top bar into the sidebar.
    expect(screen.getByRole('button', { name: 'Search reports, trends and pages' })).toHaveAttribute('data-spot', 'nav.find');
    expect(document.querySelector('.topbar [data-spot="top.search"]')).toBeNull();
  });

  it('folds overlapping tools into their new homes instead of listing them separately', async () => {
    await openApp();
    for (const removed of ['Content board', 'Asset library', 'Signal feed', 'Conversations', 'Topics', 'Source coverage', 'Brand context']) expect(screen.queryByRole('button', { name: removed })).not.toBeInTheDocument();
    for (const example of workflow.initialCards) expect(screen.queryByText(example.title)).not.toBeInTheDocument();
    fireEvent.click(nav('Activity'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument();
  });

  it('returns to the scraper library after leaving a cancelled creation flow', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'New scraper' }));
    expect(await screen.findByRole('heading', { name: 'Create a scraper' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All scrapers' }));
    fireEvent.click(nav('Overview'));
    fireEvent.click(nav('Scrapers'));
    expect(await screen.findByRole('heading', { name: /Your scrapers/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create a scraper' })).not.toBeInTheDocument();
  });

  it('opens the selected source in the new-scraper flow', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: /Reddit.*Conversations/ }));
    expect(await screen.findByRole('heading', { name: 'Create a scraper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reddit' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Scraper name' })).toHaveValue('Subreddit pulse');
  });
});

describe('Semrush studio shell', () => {
  async function openSemrush() {
    const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }, { id: 'general', name: 'General studio', editionId: 'general', knowledge: {}, products: [] }];
    let current = { ...emptyState(), contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {} } };
    window.apifyStudio = {
      appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => current), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
      contentCatalog: vi.fn(async () => ({ editions: [{ id: 'general', label: 'General studio' }, { id: 'semrush', label: 'Semrush workspace' }], deliverables: [] })),
      selectContentWorkspace: vi.fn(async id => { current = { ...current, contentStudio: { ...current.contentStudio, activeWorkspaceId: id } }; return true; }),
    };
    const result = render(<App />);
    await screen.findByRole('heading', { name: 'This week in Semrush workspace' });
    return result;
  }
  it('uses the focused destinations, controls the Studio view, and keeps legacy tools reachable', async () => {
    const { container } = await openSemrush();
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'semrush');
    expect(screen.getByRole('img', { name: 'Semrush' })).toHaveAttribute('src', expect.stringContaining('semrush-2026-logo.svg'));
    expect(container.querySelector('.cs-hero-art')).not.toBeInTheDocument();
    expect(navLabels()).toEqual(['Home', 'Inbox', 'Research programs', 'Trend board', 'Sheets', 'Create content', 'Library', 'Calendar', 'Brand knowledge', 'Data tools', 'Settings']);
    expect(screen.queryByRole('navigation', { name: 'Content studio' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Workspace:/ })).toHaveLength(1);
    fireEvent.click(nav('Create content'));
    expect(screen.getByLabelText('Source title')).toBeVisible();
    expect(nav('Create content')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'This week in Semrush workspace' })).not.toBeInTheDocument();
    fireEvent.click(nav('Research programs'));
    expect(nav('Research programs')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'New program' })).toBeVisible();
    fireEvent.click(nav('Data tools'));
    expect(nav('Search platforms')).toBeVisible();
    fireEvent.click(nav('Search platforms'));
    expect(await screen.findByRole('tab', { name: 'Sources & filters' })).toBeVisible();
    fireEvent.click(nav('Library'));
    expect(await screen.findByText('Make something worth sharing')).toBeVisible();
  });
  it('keeps the sidebar workspace switcher available when leaving Semrush and switching back from General search', async () => {
    const { container } = await openSemrush();
    const switcher = () => screen.getByRole('button', { name: /^Workspace:/ });
    const switchTo = (name) => { fireEvent.click(switcher()); fireEvent.click(within(screen.getByRole('menu', { name: 'Workspaces' })).getByRole('menuitemradio', { name })); };
    switchTo('General studio');
    await screen.findByRole('navigation', { name: 'Content studio' });
    expect(window.apifyStudio.selectContentWorkspace).toHaveBeenCalledWith('general');
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'general');
    expect(screen.queryByRole('img', { name: 'Semrush' })).not.toBeInTheDocument();
    expect(container.querySelector('.cs-hero-pattern')).not.toBeInTheDocument();
    expect(nav('Content studio')).toBeVisible();
    fireEvent.click(nav('Data tools'));
    expect(nav('Ask your datasets')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Workspace:/ })).toHaveLength(1);
    expect(switcher()).toHaveAccessibleName(/^Workspace: General studio\./);

    fireEvent.click(nav('Search platforms'));
    expect(await screen.findByRole('tab', { name: 'Sources & filters' })).toBeVisible();
    expect(switcher()).toBeVisible();
    switchTo('Semrush workspace');

    await waitFor(() => expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'semrush'));
    expect(window.apifyStudio.selectContentWorkspace.mock.calls).toEqual([['general'], ['semrush']]);
    expect(switcher()).toHaveAccessibleName(/^Workspace: Semrush workspace\./);
    expect(screen.getAllByRole('button', { name: /^Workspace:/ })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Semrush' })).toBeVisible();
    expect(nav('Research programs')).toBeVisible();
    fireEvent.click(nav('Home'));
    expect(await screen.findByRole('heading', { name: 'This week in Semrush workspace' })).toBeVisible();
  });
});

describe('Simple mode', () => {
  const trendRun = { id: 'run-1', workspaceId: 'semrush', programId: 'p1', status: 'awaiting-review', createdAt: '2026-10-10T10:00:00Z', discoveredThemes: [{ id: 't1', name: 'AI search visibility', description: 'Teams ask how to show up in AI answers.', evidenceIds: ['a', 'b'], platforms: ['reddit'] }], decisions: {} };
  async function openSimple(overrides = {}) {
    const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
    let current = { ...emptyState(), settings: { maxItems: 1000, sheets: {} }, keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [{ id: 'p1', workspaceId: 'semrush', name: 'Weekly listening', budgets: { collectionUsd: 5, aiUsd: 3 } }], researchRuns: [trendRun], contentRuns: [], assets: [{ id: 'asset-1', workspaceId: 'semrush', kind: 'text', title: 'Evidence report: AI search', createdAt: '2026-10-11T10:00:00Z' }], availableDatasets: [], availableReports: [], capabilities: {} }, ...overrides };
    const api = {
      appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => current), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
      contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })),
      readStudioAsset: vi.fn(async () => ({ markdown: '# Evidence report: AI search\n\nPeople want answers.' })),
      decideResearchTheme: vi.fn(async () => true),
      saveSettings: vi.fn(async (settings) => { current = { ...current, settings: { ...current.settings, ...settings } }; return current; }),
      // The desktop main process mirrors the person's layout into settings.uiMode, as this mock does.
      setViewPrefs: vi.fn(async (prefs) => { current = { ...current, settings: { ...current.settings, ...prefs } }; return { viewer: null }; }),
      askHelp: vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [{ kind: 'approve-trend', label: 'Approve it', target: 'AI search visibility' }] })),
    };
    window.apifyStudio = api;
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^This week in/ }); // Home is the weekly briefing
    return api;
  }

  it('opens in Simple mode by default with its pages, Settings, and Ask AI pinned above them', async () => {
    await openSimple();
    expect(navLabels()).toEqual(['Home', 'Trends', 'Reports', 'Assets', 'Inbox', 'Calendar', 'Settings']);
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('data-spot', 'nav.ask');
    expect(nav('Trends')).toHaveAccessibleName('Trends, 1 needs your OK');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('group', { name: 'Research' })).not.toBeInTheDocument();
    // Home is the weekly briefing; the trend waiting for an OK leads it.
    expect(screen.getByRole('heading', { level: 2, name: /^Needs your OK/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, use it: AI search visibility/ })).toBeInTheDocument();
  });

  it('opens the Settings section a #/settings link names', async () => {
    const scrolled = [];
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); };
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    window.history.replaceState(null, '', '/#/settings/web-address');
    try {
      await openSimple();
      expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
      await waitFor(() => expect(scrolled).toContain('settings-web-address'));
      expect(window.location.hash).toBe(''); // a reload doesn't reopen it
    } finally { frame.mockRestore(); delete Element.prototype.scrollIntoView; window.history.replaceState(null, '', '/'); }
  });

  it('reads a report and decides a trend in one tap', async () => {
    const api = await openSimple();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Evidence report: AI search/ }));
    expect(await screen.findByText('People want answers.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Trends/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, use it/ }));
    expect(api.decideResearchTheme).toHaveBeenCalledWith({ runId: 'run-1', themeId: 't1', decision: 'approved' });
  });

  it('asks about the open report with its text, and Esc returns to the list', async () => {
    const api = await openSimple();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Evidence report: AI search/ }));
    expect(await screen.findByText('People want answers.')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: /^Evidence report: AI search/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI about this' }));
    await waitFor(() => expect(api.askHelp).toHaveBeenCalled());
    const request = api.askHelp.mock.calls[0][0];
    expect(request.question).toMatch(/next steps/);
    expect(request.context).toContain('People want answers.'); // the report travels as the question's background
    expect(await screen.findByText('With the report you had open')).toBeInTheDocument();
  });

  it('runs an Ask AI action only when the button is clicked', async () => {
    const api = await openSimple();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'Approve the AI search trend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const button = await screen.findByRole('button', { name: 'Approve it' });
    expect(api.decideResearchTheme).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.decideResearchTheme).toHaveBeenCalledWith({ runId: 'run-1', themeId: 't1', decision: 'approved' }));
    expect(await screen.findByText(/Approved “AI search visibility”/)).toBeInTheDocument();
  });

  it('shows Ask AI pictures and campaign visuals together in Assets', async () => {
    const api = await openSimple({ contentStudio: { activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }], programs: [], researchRuns: [], contentRuns: [], assets: [{ id: 'visual-1', workspaceId: 'semrush', kind: 'image', title: 'Campaign hero', channel: 'design', createdAt: '2026-10-08T10:00:00Z' }], availableDatasets: [], availableReports: [], capabilities: {} } });
    api.listHelpImages = vi.fn(async () => [{ id: 'help-image-1', title: 'Sky whales', prompt: 'Whales above a city', size: '1536x1024', createdAt: '2026-10-09T10:00:00Z', costUsd: 0.2 }]);
    api.readHelpImage = vi.fn(async () => ({ id: 'help-image-1', dataUrl: 'data:image/png;base64,AAAA' }));
    api.readStudioAsset = vi.fn(async () => ({ imageDataUrl: 'data:image/png;base64,BBBB' }));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Assets/ }));
    const cards = await screen.findAllByRole('button', { name: /^Open / });
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['Open Sky whales', 'Open Campaign hero']);
    expect(screen.getByRole('button', { name: /Made in Ask AI/ })).toBeInTheDocument();
    fireEvent.click(cards[0]);
    expect(await screen.findByText('Whales above a city')).toBeInTheDocument();
  });

  it('switches to the Advanced layout from the sidebar', async () => {
    const api = await openSimple();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', { name: 'Advanced' }));
    await waitFor(() => expect(api.setViewPrefs).toHaveBeenCalledWith({ uiMode: 'classic' }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(await within(screen.getByRole('navigation', { name: 'Main' })).findByRole('group', { name: 'Research' })).toBeInTheDocument();
  });
});
