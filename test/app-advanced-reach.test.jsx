// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';

afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); });
const TREND = 'AI Citation Tracking ROI Breakdown';
const kitRun = { id: 'content-kit', workspaceId: 'semrush', type: 'content', title: TREND, status: 'succeeded', createdAt: '2026-10-16T13:52:00.000Z', jobs: [],
  kit: { sourceKey: 'theme:theme-1', sourceKind: 'trend', sourceTitle: TREND, folderName: `Golden Thread — ${TREND} (2026-10-16)`, reportAssetId: 'asset-report', themeId: 'theme-1' } };
const assets = [
  { id: 'asset-report', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'evidence-report', kind: 'text', title: `${TREND} — Comprehensive Trends Report`, createdAt: '2026-10-10T10:00:00Z' },
  { id: 'asset-toolkit', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'editorial-toolkit', kind: 'text', title: `TREND: ${TREND}`, createdAt: '2026-10-10T10:00:00Z' },
];
const plan = { title: TREND, sourceKey: 'theme:theme-1', sourceKind: 'trend', characters: 27322, evidenceCount: 19, earlierRuns: 1, imagesReady: true, warnings: [], minutes: 12,
  estimate: { totalUsd: 9.4, capUsd: 25, calls: 1, pictures: 0, modelLabel: 'Claude Fable 5.1' },
  folders: [{ id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', selected: true, available: true }] }] };

// The Advanced layout (settings.uiMode), as the local admin.
async function openAdvanced() {
  const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
  const state = { projects: [], recipes: [], datasets: [{ id: 'd1', name: 'Saved posts', itemCount: 3, createdAt: '2026-10-01T00:00:00Z' }], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }, settings: { maxItems: 1000, sheets: {}, uiMode: 'classic' }, v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [], researchRuns: [], contentRuns: [{ id: 'content-trend', workspaceId: 'semrush', type: 'content', title: TREND, themeId: 'theme-1', status: 'succeeded', createdAt: '2026-10-10T10:00:00Z', jobs: [] }, kitRun], assets, availableDatasets: [], availableReports: [], capabilities: {} } };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), readHelpImage: vi.fn(async () => ({})),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ markdown: `# Draft ${assetId}\n\nBody text for ${assetId}.` })),
    planAssetKit: vi.fn(async () => plan), createAssetKit: vi.fn(async () => kitRun), setViewPrefs: vi.fn(async () => ({})), saveSettings: vi.fn(async () => ({})),
  };
  window.apifyStudio = api;
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: /^This week in/ });
  return api;
}
const mode = () => document.querySelector('.app-shell')?.dataset.mode;

describe('the Advanced layout reaches what Simple has', () => {
  it('makes channel assets over the page, without switching the person to Simple', async () => {
    const api = await openAdvanced();
    expect(mode()).toBe('classic');
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Channel assets/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Which report should the assets come from?' });
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(TREND) }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Next: check what’s made/ }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-report' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make 1 asset' }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledOnce());
    // A toast offers the folder; the layout never changed.
    expect(await screen.findByRole('button', { name: 'Open folder' })).toBeInTheDocument();
    expect(mode()).toBe('classic');
    expect(api.setViewPrefs).not.toHaveBeenCalledWith(expect.objectContaining({ uiMode: 'simple' }));
    expect(api.saveSettings).not.toHaveBeenCalledWith(expect.objectContaining({ uiMode: 'simple' }));
  });

  it('never reads a dataset’s rows until the Datasets page opens', async () => {
    const api = await openAdvanced();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.readDataset).not.toHaveBeenCalled();
  });

  it('finds channel-asset folders in ⌘K and opens them in the Library', async () => {
    await openAdvanced();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: 'folder' } });
    fireEvent.click(await within(palette).findByRole('button', { name: new RegExp(`Open folder: ${TREND}`) }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your asset library' })).toBeInTheDocument();
  });
});
