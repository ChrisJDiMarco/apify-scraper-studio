// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { HelpAssistant } from '../src/renderer/src/help-assistant.jsx';

afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); });
const TREND = 'AI Citation Tracking ROI Breakdown';
const at = '2026-10-16T13:52:00.000Z';
// A trend with its report pair, and one finished channel asset kit made from it.
const kitRun = { id: 'content-kit', workspaceId: 'semrush', type: 'content', title: TREND, status: 'partial', createdAt: at, costUsd: 9.12, maxBudgetUsd: 25, reservedUsd: 9.5, sourceAssetId: 'asset-report', ai: { model: 'claude-fable-5-1', effort: 'high' },
  kit: { sourceKey: 'theme:theme-1', sourceKind: 'trend', sourceTitle: TREND, folderName: `Golden Thread — ${TREND} (2026-10-16)`, reportAssetId: 'asset-report' },
  jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', folder: 'Semrush Blog', status: 'succeeded' }, { id: 'ads', label: 'Paid Media — Search Ads + Keywords', kind: 'text', folder: 'Semrush Paid Media', status: 'failed', error: 'output.sections.headlines.items.0.text must be 30 characters or fewer.' }, { id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', folder: 'Semrush Social Team', status: 'succeeded' }] };
const assets = [
  { id: 'asset-report', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'evidence-report', kind: 'text', title: `${TREND} — Comprehensive Trends Report`, channel: 'Research', createdAt: '2026-10-10T10:00:00Z' },
  { id: 'asset-toolkit', workspaceId: 'semrush', runId: 'content-trend', deliverableId: 'editorial-toolkit', kind: 'text', title: `TREND: ${TREND}`, channel: 'Strategy', createdAt: '2026-10-10T10:00:00Z' },
  { id: 'kit-blog', workspaceId: 'semrush', runId: 'content-kit', deliverableId: 'blogshort', kind: 'text', title: 'AI citations are the new rankings', channel: 'Blog', createdAt: at },
  { id: 'kit-hero', workspaceId: 'semrush', runId: 'content-kit', deliverableId: 'brand-image', variantIndex: 0, kind: 'image', title: 'Social Team — Hero Graphic · 1', channel: 'Design', createdAt: at },
];
const plan = { title: TREND, sourceKey: 'theme:theme-1', sourceKind: 'trend', characters: 27322, evidenceCount: 19, earlierRuns: 1, imagesReady: true, warnings: [], minutes: 12,
  estimate: { totalUsd: 9.4, capUsd: 25, calls: 3, pictures: 3, modelLabel: 'Claude Fable 5.1' },
  folders: [{ id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', selected: true, available: true, usd: 0.6 }] }, { id: 'paidmedia', name: 'Semrush Paid Media', items: [{ id: 'ads', label: 'Paid Media — Search Ads + Keywords', kind: 'text', selected: true, available: true, usd: 0.7 }] }, { id: 'social', name: 'Semrush Social Team', items: [{ id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', pictures: 3, selected: true, available: true, usd: 0.5 }] }] };

async function openSimple({ askHelp } = {}) {
  const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
  const state = { projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }, settings: { maxItems: 1000, sheets: {} }, v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [], researchRuns: [], contentRuns: [{ id: 'content-trend', workspaceId: 'semrush', type: 'content', title: TREND, themeId: 'theme-1', status: 'succeeded', createdAt: '2026-10-10T10:00:00Z', jobs: [] }, kitRun], assets, availableDatasets: [], availableReports: [], capabilities: { googlePublishConfigured: true } } };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), readHelpImage: vi.fn(async () => ({})),
    readStudioAsset: vi.fn(async ({ assetId }) => (assetId === 'kit-hero' ? { imageDataUrl: 'data:image/png;base64,AAAA' } : { markdown: `# Draft ${assetId}\n\nBody text for ${assetId}.` })),
    planAssetKit: vi.fn(async () => plan), createAssetKit: vi.fn(async () => kitRun), saveAssetKitFolder: vi.fn(async () => ({ savedTo: 'downloads' })), retryStudioRun: vi.fn(async () => kitRun), publishStudioRun: vi.fn(async () => ({ status: 'succeeded' })),
    askHelp: askHelp || vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [] })),
  };
  window.apifyStudio = api;
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: /^This week in/ }); // Home is the weekly briefing
  return api;
}
const tab = (name) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: new RegExp(name) }));

describe('Assets: report folders of channel assets', () => {
  it('keeps kit drafts out of Reports and files them in a report folder by channel team', async () => {
    const api = await openSimple();
    tab('Reports');
    expect(await screen.findByText(/2 reports, newest first/)).toBeInTheDocument();
    expect(screen.queryByText('AI citations are the new rankings')).not.toBeInTheDocument();
    tab('Assets');
    fireEvent.click(await screen.findByRole('button', { name: `Open the ${TREND} folder` }));
    const run = await screen.findByRole('region', { name: `Golden Thread — ${TREND} (2026-10-16)` });
    expect(within(run).getByText(/2 of 3 ready · 1 needs another try · \$9\.12 · Claude Fable 5\.1/)).toBeInTheDocument();
    expect(within(run).getByRole('region', { name: 'Semrush Blog' })).toHaveTextContent('Blog — Short News Update');
    expect(within(run).getByRole('region', { name: 'Semrush Paid Media' })).toHaveTextContent('Didn’t pass its checks after a second try');
    fireEvent.click(within(run).getByRole('button', { name: 'Open Blog — Short News Update' }));
    expect(await screen.findByText('Body text for kit-blog.')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(run).getByRole('button', { name: /Finish the rest/ }));
    await waitFor(() => expect(api.retryStudioRun).toHaveBeenCalledWith({ runId: 'content-kit', maxBudgetUsd: 25 }));
    fireEvent.click(within(run).getByRole('button', { name: /Save folder/ }));
    await waitFor(() => expect(api.saveAssetKitFolder).toHaveBeenCalledWith({ runId: 'content-kit' }));
  });

  it('makes channel assets from a report: pick, check the cost, untick, then make', async () => {
    const api = await openSimple();
    tab('Assets');
    fireEvent.click(await screen.findByRole('button', { name: 'Make channel assets' }));
    const dialog = await screen.findByRole('dialog', { name: 'Which report should the assets come from?' });
    const trend = within(dialog).getByRole('radio', { name: new RegExp(TREND) });
    expect(trend).toHaveTextContent('Trends report + editorial toolkit');
    fireEvent.click(trend);
    fireEvent.click(within(dialog).getByRole('button', { name: /Next: check what’s made/ }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-report' } }));
    const review = await screen.findByRole('dialog', { name: 'Check what will be made' });
    expect(within(review).getByText('About $9.40')).toBeInTheDocument();
    expect(within(review).getByText('Stops at $25.00 at most')).toBeInTheDocument();
    expect(within(review).getByText(/No brand reference images yet, so pictures follow the brand colors/)).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('checkbox', { name: /Search Ads \+ Keywords/ }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenLastCalledWith({ source: { kind: 'report', assetId: 'asset-report' }, deliverableIds: ['blogshort', 'brand-image'] }));
    fireEvent.click(within(review).getByRole('button', { name: /Make \d+ assets/ }));
    await waitFor(() => expect(api.createAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-report' }, deliverableIds: ['blogshort', 'brand-image'], maxBudgetUsd: 25 }));
    expect(await screen.findByRole('region', { name: `Golden Thread — ${TREND} (2026-10-16)` })).toBeInTheDocument();
  });

  it('says which picture sets send brand reference images, and links to them in Settings', async () => {
    const api = await openSimple();
    const withReferences = { ...plan, folders: plan.folders.map(folder => ({ ...folder, items: folder.items.map(item => (item.kind === 'image' ? { ...item, references: { style: 2, logo: 1 } } : item)) })) };
    api.planAssetKit.mockResolvedValue(withReferences);
    Object.assign(api, { addBrandImage: vi.fn(), readBrandImage: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AAAA' })), setBrandImageRole: vi.fn(), removeBrandImage: vi.fn() });
    tab('Assets');
    fireEvent.click(await screen.findByRole('button', { name: 'Make channel assets' }));
    const dialog = await screen.findByRole('dialog', { name: 'Which report should the assets come from?' });
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(TREND) }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Next: check what’s made/ }));
    const review = await screen.findByRole('dialog', { name: 'Check what will be made' });
    expect(await within(review).findByText(/Brand reference images: 1 of 1 picture set, 1 with the approved logo\./)).toBeInTheDocument();
    expect(within(review).getByRole('checkbox', { name: /Hero Graphic/ })).toHaveAttribute('title', 'Sends 2 style examples and the approved logo');
    fireEvent.click(within(review).getByRole('button', { name: 'Change them in Settings' }));
    // The workspace's picture sets arrive with the next state push, as they do from the main process.
    const current = await api.state(); const push = api.onStateChanged.mock.calls.at(-1)[0];
    act(() => push({ ...current, contentStudio: { ...current.contentStudio, workspaces: current.contentStudio.workspaces.map(row => ({ ...row, brandImageSets: [{ id: 'sel-editorial', deliverableId: 'sel-image', label: 'Search Engine Land editorial heroes', hint: '', max: 6, images: [] }] })) } }));
    expect(await screen.findByRole('heading', { name: 'Brand reference images' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Search Engine Land editorial heroes' })).toBeInTheDocument();
  });

  it('opens the asset dialog on the report being read', async () => {
    const api = await openSimple();
    tab('Reports');
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${TREND}`) }))[0]); // one row per trend, named after it
    fireEvent.click(await screen.findByRole('button', { name: 'Make channel assets' }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-report' } }));
    expect(await screen.findByText('1 earlier run in its folder', { exact: false })).toBeInTheDocument();
  });
});

describe('Ask AI does the work and shows the way', () => {
  it('opens the asset dialog for the report it names when its button is clicked', async () => {
    const askHelp = vi.fn(async () => ({ answer: 'Here’s the kit for that trend.', pages: [], followUps: [], actions: [{ kind: 'make-assets', label: 'Make assets for AI Citation Tracking', target: 'AI Citation Tracking ROI Breakdown', assetId: 'asset-report' }] })); // the server resolves names to ids
    const api = await openSimple({ askHelp });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'Make every channel asset for my latest trend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make assets for AI Citation Tracking' }));
    await waitFor(() => expect(api.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-report' } }));
    expect(api.createAssetKit).not.toHaveBeenCalled(); // the person still checks the cost and presses Make
    expect(await screen.findByRole('dialog', { name: 'Check what will be made' })).toBeInTheDocument();
  });

  it('takes the person to the control and spotlights it, step by step', async () => {
    const askHelp = vi.fn(async () => ({ answer: 'Your folders are in Assets.', pages: [], followUps: [], actions: [], show: { autoStart: true, steps: [{ target: 'assets.folder', item: TREND, say: 'Each report gets a folder here.' }, { target: 'kit.save', item: TREND, say: 'Save the run as a folder.' }] } }));
    await openSimple({ askHelp });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI' }), { target: { value: 'Where are my channel assets?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const note = await screen.findByRole('dialog', { name: 'Ask AI is showing you' });
    expect(note).toHaveTextContent('Step 1 of 2'); expect(note).toHaveTextContent('Each report gets a folder here.');
    expect(await screen.findByRole('button', { name: `Open the ${TREND} folder` })).toBeInTheDocument(); // it moved to Assets
    fireEvent.click(within(note).getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Ask AI is showing you' })).toHaveTextContent('Save the run as a folder.'));
    expect(await screen.findByRole('region', { name: `Golden Thread — ${TREND} (2026-10-16)` })).toBeInTheDocument(); // and opened the folder
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Ask AI is showing you' })).getByRole('button', { name: /Back to chat/ }));
    expect(screen.queryByRole('dialog', { name: 'Ask AI is showing you' })).not.toBeInTheDocument();
    expect(await screen.findByText('Your folders are in Assets.')).toBeVisible();
  });
});

describe('Ask AI panel: Show me and reading', () => {
  it('offers Show me, starts it on request, and says what it read', async () => {
    const steps = [{ target: 'settings.images', item: '', say: 'Turn pictures on here.' }];
    const api = { askHelp: vi.fn(async () => ({ answer: 'Add an OpenAI key.', pages: [], followUps: [], actions: [], show: { autoStart: false, steps }, read: [{ kind: 'report', title: 'AI Overviews report' }] })) };
    const onShow = vi.fn();
    render(<HelpAssistant api={api} open onClose={vi.fn()} page={{ id: 'simple-mode', label: 'Simple mode' }} onOpenPage={vi.fn()} onShow={onShow} variant="page" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question about Golden Thread' }), { target: { value: 'Where do I turn on pictures?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer).toHaveTextContent('Read “AI Overviews report”');
    expect(onShow).not.toHaveBeenCalled();
    fireEvent.click(within(answer).getByRole('button', { name: 'Show me' }));
    expect(onShow).toHaveBeenCalledWith(steps);
  });
});
