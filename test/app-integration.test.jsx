// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { createRequire } from 'node:module';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';

// Wave 2 as App wires it (SPEC-2): the Inbox, Calendar and Prompts pages in both layouts, share links opened after the
// studio loads, the New menu's kinds, and Yes with a note on Simple's trend cards.
const require = createRequire(import.meta.url);
const template = require('../src/shared/prompt-template.js');
const REGISTRY = template.registryFor('semrush');

afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } window.history.replaceState(null, '', '/'); });

const NOW = new Date().toISOString();
const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
const trendRun = { id: 'run-1', workspaceId: 'semrush', programId: 'p1', status: 'awaiting-review', createdAt: NOW, updatedAt: NOW, discoveredThemes: [{ id: 't1', name: 'AI search visibility', description: 'Teams ask how to show up in AI answers.', evidenceIds: ['a', 'b'], platforms: ['reddit'] }], decisions: {} };
const baseState = (uiMode = 'simple') => ({
  projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [],
  keys: { APIFY_API_TOKEN: true }, settings: { maxItems: 1000, sheets: {}, uiMode },
  v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
  contentStudio: {
    activeWorkspaceId: 'semrush', workspaces, programs: [{ id: 'p1', workspaceId: 'semrush', name: 'Weekly listening', budgets: { collectionUsd: 5, aiUsd: 3 } }],
    researchRuns: [trendRun], contentRuns: [], themes: [], availableDatasets: [], availableReports: [], capabilities: {}, promptChanges: [],
    assets: [{ id: 'asset-1', workspaceId: 'semrush', kind: 'text', title: 'Evidence report: AI search', createdAt: NOW }],
  },
});
const promptRow = (entry) => ({ id: entry.id, name: entry.name, group: entry.group, description: entry.description, powers: entry.powers, editable: entry.blocks.some((block) => block.editable), version: 0, custom: false, locked: false, updatedAt: '', updatedBy: null, defaultChanged: false });
const promptDetail = (id) => { const entry = REGISTRY.prompts.find((row) => row.id === id); return { prompt: entry, editionId: 'semrush', blocks: template.blocksFor(id, 'semrush'), defaults: template.defaultsFor(id, 'semrush'), customized: [], defaultChanged: [], version: 0, locked: false, lock: null, lockedForYou: false, updatedAt: '', updatedBy: null, history: [], tests: [], damaged: false, model: 'claude-opus-5-5', modelLabel: 'Claude Opus 5.5', effort: 'medium', route: 'claude-api', metered: true, testable: true }; };

async function openStudio({ uiMode = 'simple', hash = '', api: extra = {} } = {}) {
  if (hash) window.history.replaceState(null, '', `/${hash}`);
  let current = baseState(uiMode);
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => current), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []),
    readStudioAsset: vi.fn(async () => ({ markdown: '# Evidence report: AI search\n\nPeople want answers.' })),
    decideResearchTheme: vi.fn(async () => true), startResearchRun: vi.fn(async () => ({ id: 'research-2' })), saveResearchProgram: vi.fn(async (program) => ({ program })),
    saveSettings: vi.fn(async (settings) => { current = { ...current, settings: { ...current.settings, ...settings } }; return current; }),
    setViewPrefs: vi.fn(async (prefs) => { current = { ...current, settings: { ...current.settings, ...prefs } }; return { viewer: null }; }),
    askHelp: vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [] })), startQuickScan: vi.fn(), estimateQuickScan: vi.fn(),
    listPrompts: vi.fn(async () => ({ editionId: 'semrush', groups: REGISTRY.groups, prompts: REGISTRY.prompts.map(promptRow) })),
    readPrompt: vi.fn(async ({ id }) => promptDetail(id)),
    previewPrompt: vi.fn(async ({ id }) => ({ id, text: 'Prompt text', segments: [], chars: 11, tokens: 3, estimateUsd: 0.01, sampleLabel: 'Sample data', sample: 'bundled', problems: [] })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  // A share link leaves Home before its heading is drawn; the test waits for where the link leads instead.
  if (!hash) await screen.findByRole('heading', { level: 1, name: /^This week in/ });
  else await screen.findByRole('navigation', { name: 'Main' });
  return api;
}
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const navButton = (name) => mainNav().getByRole('button', { name: new RegExp(`^${name}`) });

describe('pages both layouts share', () => {
  it('opens the Inbox from the sidebar, and Mark all read is saved for the person', async () => {
    const api = await openStudio();
    expect(navButton('Inbox')).toHaveAccessibleName(/^Inbox, 1 unread$/);
    fireEvent.click(navButton('Inbox'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 trend needs your OK/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(api.setViewPrefs).toHaveBeenCalledWith({ inboxSeenAt: expect.any(String) }));
  });

  it('opens the Calendar in Simple and in Advanced', async () => {
    await openStudio();
    fireEvent.click(navButton('Calendar'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    cleanup(); delete window.apifyStudio;
    await openStudio({ uiMode: 'classic' });
    fireEvent.click(navButton('Calendar'));
    expect((await screen.findAllByRole('heading', { level: 1, name: 'Calendar' })).length).toBeGreaterThan(0); // the top bar names the page too
    expect(document.querySelector('.cal-page')).toBeInTheDocument();
    expect(navButton('Calendar')).toHaveAttribute('aria-current', 'page');
  });

  it('lists Prompts in the Studio group and opens the Prompt Library there', async () => {
    const api = await openStudio();
    const studio = within(mainNav().getByRole('group', { name: 'Studio' }));
    fireEvent.click(studio.getByRole('button', { name: /^Prompts/ }));
    expect(await screen.findByRole('navigation', { name: 'All prompts' })).toBeInTheDocument();
    expect(api.listPrompts).toHaveBeenCalled();
  });
});

describe('share links', () => {
  it('opens a report link in Simple’s reader once the studio has loaded, and clears the address', async () => {
    const api = await openStudio({ hash: '#/report/asset-1' });
    expect(await screen.findByText('People want answers.')).toBeInTheDocument();
    expect(api.readStudioAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-1' }));
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('opens a prompt link on the Prompts page', async () => {
    const api = await openStudio({ hash: '#/prompt/research.discovery' });
    await waitFor(() => expect(api.readPrompt).toHaveBeenCalledWith({ id: 'research.discovery' }));
    expect(await screen.findByRole('navigation', { name: 'All prompts' })).toBeInTheDocument();
  });

  it('says so when a report link isn’t in this workspace', async () => {
    await openStudio({ hash: '#/report/asset-gone' });
    expect(await screen.findByText(/That report isn’t in this workspace/)).toBeInTheDocument();
  });
});

describe('the New menu', () => {
  it('opens Ask AI with the quick scan sentence started for the person to finish', async () => {
    await openStudio();
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'New' })).getByRole('menuitem', { name: 'Quick scan' }));
    expect(await screen.findByRole('textbox', { name: 'Question about Scraper Studio' })).toHaveValue('Plan a quick scan on ');
  });

  it('opens a blank research program in the Advanced layout', async () => {
    await openStudio({ uiMode: 'classic' });
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'New' })).getByRole('menuitem', { name: 'Research program' }));
    expect(navButton('Research programs')).toHaveAttribute('aria-current', 'page');
    const name = await screen.findByLabelText(/Program name/);
    expect(name).toHaveValue('');
  });
});

describe('Yes, with a note, on Simple’s trend cards', () => {
  it('sends the note and the chosen channels with the decision', async () => {
    const api = await openStudio();
    fireEvent.click(navButton('Trends'));
    await screen.findByRole('heading', { level: 1, name: 'Trends' });
    fireEvent.click(screen.getByRole('button', { name: 'More ways to say yes to AI search visibility' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Yes, with a note/ }));
    const sheet = await screen.findByRole('dialog', { name: 'AI search visibility' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Social' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: /Note for the channels/ }), { target: { value: 'Lead with the CTR data.' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Say yes' })); });
    await waitFor(() => expect(api.decideResearchTheme).toHaveBeenCalledWith({ runId: 'run-1', themeId: 't1', decision: 'approved', note: 'Lead with the CTR data.', channels: ['social'] }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI search visibility' })).not.toBeInTheDocument());
  });
});
