// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import workflow from '../src/shared/asset-workflow.json';

const emptyState = () => ({
  projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [],
  keys: {}, settings: { maxItems: 1000, sheets: {} },
  v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
});

afterEach(() => { cleanup(); delete window.apifyStudio; });

async function openApp() {
  window.apifyStudio = {
    appMeta: vi.fn(async () => ({ version: 'test' })),
    state: vi.fn(async () => emptyState()),
    onStateChanged: vi.fn(() => () => {}),
    readDataset: vi.fn(async () => ({ items: [], rawItems: [] })),
  };
  render(<App />);
  await screen.findByRole('heading', { name: /Research your market/ });
}

function nav(name) { return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name }); }

describe('workspace navigation', () => {
  it('exposes search and findings alongside primary destinations and keeps advanced tools collapsed', async () => {
    await openApp();
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(primary.getAllByRole('button').map((button) => button.textContent)).toEqual(['Content studio', 'Overview', 'Playbooks', 'Search platforms', 'Chat with findings', 'Scrapers', 'Datasets', 'AI reports', 'Activity', 'More tools']);
    expect(primary.getByRole('button', { name: 'More tools' })).toHaveAttribute('aria-expanded', 'false');
    expect(primary.queryByRole('button', { name: 'Workflows' })).not.toBeInTheDocument();
  });

  it('folds overlapping tools into their new homes instead of listing them separately', async () => {
    await openApp();
    fireEvent.click(nav('More tools'));
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
    await screen.findByRole('heading', { name: 'From a trend to a complete campaign.' });
    return result;
  }
  it('uses the six focused destinations, controls the Studio view, and keeps legacy tools reachable', async () => {
    const { container } = await openSemrush();
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'semrush');
    expect(screen.getByRole('img', { name: 'Semrush' })).toHaveAttribute('src', expect.stringContaining('semrush-2026-logo.svg'));
    expect(container.querySelector('.cs-hero-pattern')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.cs-hero-art')).not.toBeInTheDocument();
    expect(primary.getAllByRole('button').map(button => button.textContent)).toEqual(['Overview', 'Research programs', 'Trend board', 'Create content', 'Library', 'Brand knowledge', 'More tools']);
    expect(screen.queryByRole('navigation', { name: 'Content studio' })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Content workspace')).toHaveLength(1);
    fireEvent.click(nav('Create content'));
    expect(screen.getByLabelText('Source title')).toBeVisible();
    expect(nav('Create content')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'From a trend to a complete campaign.' })).not.toBeInTheDocument();
    fireEvent.click(nav('Research programs'));
    expect(nav('Research programs')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'New program' })).toBeVisible();
    fireEvent.click(nav('More tools'));
    expect(nav('Search platforms')).toBeVisible();
    fireEvent.click(nav('Search platforms'));
    expect(await screen.findByRole('tab', { name: 'Sources & filters' })).toBeVisible();
    fireEvent.click(nav('Library'));
    expect(await screen.findByText('Make something worth sharing')).toBeVisible();
  });
  it('keeps a sidebar workspace picker available when leaving Semrush and switching back from General search', async () => {
    const { container } = await openSemrush();
    const sidebarPicker = () => within(container.querySelector('.shell-workspace-control')).getByRole('combobox', { name: 'Content workspace' });
    fireEvent.change(sidebarPicker(), { target: { value: 'general' } });
    await screen.findByRole('navigation', { name: 'Content studio' });
    expect(window.apifyStudio.selectContentWorkspace).toHaveBeenCalledWith('general');
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'general');
    expect(screen.queryByRole('img', { name: 'Semrush' })).not.toBeInTheDocument();
    expect(container.querySelector('.cs-hero-pattern')).not.toBeInTheDocument();
    expect(nav('Content studio')).toBeVisible();
    expect(nav('Chat with findings')).toBeVisible();
    expect(screen.getAllByLabelText('Content workspace')).toHaveLength(1);
    expect(sidebarPicker()).toHaveValue('general');

    fireEvent.click(nav('Search platforms'));
    expect(await screen.findByRole('tab', { name: 'Sources & filters' })).toBeVisible();
    expect(sidebarPicker()).toBeVisible();
    expect(within(sidebarPicker()).getByRole('option', { name: 'Semrush workspace' })).toBeInTheDocument();
    fireEvent.change(sidebarPicker(), { target: { value: 'semrush' } });

    await waitFor(() => expect(container.querySelector('.app-shell')).toHaveAttribute('data-edition', 'semrush'));
    expect(window.apifyStudio.selectContentWorkspace.mock.calls).toEqual([['general'], ['semrush']]);
    expect(sidebarPicker()).toHaveValue('semrush');
    expect(screen.getAllByLabelText('Content workspace')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Semrush' })).toBeVisible();
    expect(nav('Research programs')).toBeVisible();
    fireEvent.click(nav('Overview'));
    expect(await screen.findByRole('heading', { name: 'From a trend to a complete campaign.' })).toBeVisible();
  });
});
