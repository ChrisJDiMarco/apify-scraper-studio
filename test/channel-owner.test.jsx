// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAssets, ChannelGenerateSheet, ChannelTrends, channelPlan, linkLabel, normalizeLink } from '../src/renderer/src/channel-owner.jsx';
import { PREVIEW_TITLE } from '../src/renderer/src/viewer.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const now = new Date().toISOString();
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const channel = { id: 'blog', name: 'Semrush Blog', short: 'Blog', deliverables: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text' }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text' }] };
const trend = (over = {}) => ({ themeId: 'theme-1', name: 'AI Overviews', description: 'Answers at the top of search.', priority: 'top', category: 'Search', evidenceCount: 12, readyAt: now, primaryReportId: 'asset-toolkit-1', reportAssets: [], adoption: null, isNew: true, earlier: false, briefEditedAt: '', latestRun: null, runCount: 0, assetCount: 0, ...over });
const run = (over = {}) => ({ id: 'kit-1', title: 'AI Overviews', status: 'running', message: '', progress: { done: 1, total: 2 }, createdAt: '2026-10-12T10:00:00.000Z', finishedAt: '', kit: { sourceTitle: 'AI Overviews', themeId: 'theme-1', folderName: 'Golden Thread — AI Overviews', reportAssetId: 'asset-report-1' }, shared: false, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'succeeded', assetId: 'asset-short', assetIds: [] }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', status: 'running', assetId: '', assetIds: [] }], ...over });
const viewer = (over = {}) => ({ id: 'member-alex', name: 'Alex Smith', role: 'channel', realRole: 'channel', channelId: 'blog', channelName: 'Semrush Blog', via: 'link', preview: false, memberSince: '2026-09-01T00:00:00.000Z', prefs: { welcomedAt: '2026-10-01T00:00:00.000Z' }, ...over });
const api = (over = {}) => ({
  setTrendAdoption: vi.fn(async () => ({ adoption: null })), planAssetKit: vi.fn(async () => ({ title: 'AI Overviews', folder: { id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', pictures: 0 }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', pictures: 0 }] }, minutes: 4, imagesReady: true, edited: { byName: 'Riley', at: '2026-10-14T15:00:00.000Z' }, earlierSets: [] })),
  createAssetKit: vi.fn(async () => run({ id: 'kit-new', status: 'queued', progress: { done: 0, total: 2 }, createdAt: now })), cancelStudioRun: vi.fn(async () => ({})), retryStudioRun: vi.fn(async () => run({ status: 'queued' })),
  readStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId, title: 'Brief', edited: { at: '2026-10-14T15:00:00.000Z', byName: 'Riley' } }, markdown: `# Brief\n\nBody of ${assetId}.` })),
  openStudioAsset: vi.fn(async () => ({})), saveAssetKitFolder: vi.fn(async () => ({ savedTo: 'downloads' })), openSourceUrl: vi.fn(async () => ({})),
  ...over,
});
const view = (trends, extra = {}) => ({ channel, counts: { newTrends: trends.filter((row) => row.isNew).length }, trends, runs: [], assets: [], ...extra });
const card = (name) => screen.getByRole('article', { name });

describe('ChannelTrends: the make slot', () => {
  it('offers Generate for my channel with the channel’s files when nothing was made yet', () => {
    render(<ChannelTrends api={api()} view={view([trend()])} viewer={viewer()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Trends for Semrush Blog' })).toBeInTheDocument();
    const slot = card('AI Overviews');
    expect(within(slot).getByRole('button', { name: /Generate for my channel/ })).toBeEnabled();
    expect(within(slot).getByText('Short News Update · Long-form Article')).toBeInTheDocument();
    expect(within(slot).getByText('Top priority')).toBeInTheDocument();
    // Every card button is described by the trend's heading, so a screen reader hears which trend it acts on.
    expect(within(slot).getByRole('button', { name: /Generate for my channel/ })).toHaveAccessibleDescription('AI Overviews');
  });

  it('shows progress with Stop while a set is being written, and hides Stop for a shared set', async () => {
    const services = api();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = render(<ChannelTrends api={services} view={view([trend({ latestRun: run() })])} viewer={viewer()} />);
    const bar = screen.getByRole('progressbar', { name: 'Drafts for “AI Overviews”' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('Writing 2 of 2…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(services.cancelStudioRun).toHaveBeenCalledWith({ runId: 'kit-1' }));
    rerender(<ChannelTrends api={services} view={view([trend({ latestRun: run({ shared: true }) })])} viewer={viewer()} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('opens My assets when a set is ready, and confirms before generating another', () => {
    const onOpenAssets = vi.fn();
    const services = api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ChannelTrends api={services} view={view([trend({ latestRun: run({ status: 'succeeded', progress: { done: 2, total: 2 } }) })])} viewer={viewer()} onOpenAssets={onOpenAssets} />);
    fireEvent.click(screen.getByRole('button', { name: /Open my assets/ }));
    expect(onOpenAssets).toHaveBeenCalledWith('theme-1');
    fireEvent.click(screen.getByRole('button', { name: /Generate a new set/ }));
    expect(confirm).toHaveBeenCalledWith(`You already have drafts for this trend from ${day('2026-10-12T10:00:00.000Z')}. Generate a new set?`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(services.planAssetKit).not.toHaveBeenCalled();
  });

  it('says what didn’t finish and offers Finish the rest, unless the set was shared', async () => {
    const services = api();
    const partial = run({ status: 'partial', progress: { done: 1, total: 2 }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'succeeded', assetId: 'asset-short', assetIds: [] }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', status: 'failed', assetId: '', assetIds: [] }] });
    const { rerender } = render(<ChannelTrends api={services} view={view([trend({ latestRun: partial })])} viewer={viewer()} />);
    expect(screen.getByText('1 of 2 drafts didn’t finish.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open my assets/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Finish the rest/ }));
    await waitFor(() => expect(services.retryStudioRun).toHaveBeenCalledWith({ runId: 'kit-1' }));
    rerender(<ChannelTrends api={services} view={view([trend({ latestRun: { ...partial, shared: true } })])} viewer={viewer()} />);
    expect(screen.queryByRole('button', { name: /Finish the rest/ })).not.toBeInTheDocument();
    expect(screen.getByText('This set was made with other channels. Ask an editor.')).toBeInTheDocument();
  });

  it('keeps a trend’s drafts one tap away when the newest set made with other channels didn’t finish', async () => {
    const shared = run({ id: 'kit-shared', status: 'failed', shared: true, progress: { done: 0, total: 1 }, createdAt: '2026-10-13T10:00:00.000Z', jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'failed', assetId: '', assetIds: [] }] });
    const onOpenAssets = vi.fn(); const services = api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ChannelTrends api={services} view={view([trend({ latestRun: shared, runCount: 2, assetCount: 2, isNew: false, adoption: { status: 'using', link: '', note: '', at: now, byName: 'Alex Smith', byMe: true } })])} viewer={viewer()} onOpenAssets={onOpenAssets} />);
    const slot = card('AI Overviews');
    expect(within(slot).getByText('1 of 1 draft didn’t finish.')).toBeInTheDocument();
    expect(within(slot).getByText('This set was made with other channels. Ask an editor.')).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole('button', { name: /Open my assets/ }));
    expect(onOpenAssets).toHaveBeenCalledWith('theme-1');
    // A new set is still offered, and the question doesn't pretend the failed set has drafts.
    fireEvent.click(within(slot).getByRole('button', { name: /Generate a new set/ }));
    expect(confirm).toHaveBeenCalledWith('You already have drafts for this trend. Generate a new set?');
  });

  it('says to ask an admin, and offers no retry, when only an admin can fix what stopped a set', () => {
    const blocked = run({ status: 'failed', needsAdmin: true, message: 'Ask an admin: the AI connection needs attention.', progress: { done: 0, total: 2 }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'failed', assetId: '', assetIds: [] }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', status: 'failed', assetId: '', assetIds: [] }] });
    render(<ChannelTrends api={api()} view={view([trend({ latestRun: blocked, runCount: 1 })])} viewer={viewer()} />);
    const slot = card('AI Overviews');
    expect(within(slot).getByText('2 of 2 drafts didn’t finish.')).toBeInTheDocument();
    expect(within(slot).getByText('Ask an admin: the AI connection needs attention.')).toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: /Finish the rest/ })).not.toBeInTheDocument();
    expect(within(slot).queryByRole('button', { name: /Open my assets/ })).not.toBeInTheDocument(); // nothing was made
  });

  it('offers the drafts from earlier sets while a new one is being written', () => {
    render(<ChannelTrends api={api()} view={view([trend({ latestRun: run(), runCount: 2, assetCount: 2 })])} viewer={viewer()} onOpenAssets={vi.fn()} />);
    expect(within(card('AI Overviews')).getByRole('button', { name: /Open my assets/ })).toBeInTheDocument();
  });

  it('says only written drafts are made when pictures are off and the channel has pictures', () => {
    const social = { id: 'social', name: 'Semrush Social Team', deliverables: [{ id: 'social', label: 'Social Team — LinkedIn + X + FB Captions', kind: 'text' }, { id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image' }] };
    render(<ChannelTrends api={api()} view={{ ...view([trend()]), channel: social }} viewer={viewer({ channelId: 'social', channelName: 'Semrush Social Team' })} imagesReady={false} />);
    expect(screen.getByText('Pictures are off for your team, so only the written drafts are made.')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn + X + FB Captions')).toBeInTheDocument();
  });
});

describe('ChannelTrends: generating drafts', () => {
  it('shows what will be made, how long and the edited brief, with no money, then starts the set', async () => {
    const services = api();
    const action = vi.fn((fn) => Promise.resolve().then(fn));
    render(<ChannelTrends api={services} view={view([trend()])} viewer={viewer()} action={action} />);
    const trigger = screen.getByRole('button', { name: /Generate for my channel/ });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Generate drafts for “AI Overviews”' });
    await waitFor(() => expect(services.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-toolkit-1' }, deliverableIds: ['blogshort', 'bloglong'] }));
    expect(await within(sheet).findByText('Short News Update')).toBeInTheDocument();
    expect(within(sheet).getByText('About 4 minutes')).toBeInTheDocument();
    expect(within(sheet).getByText('Drafts appear in My assets. You’ll see progress on this card.')).toBeInTheDocument();
    expect(within(sheet).getByText(`Uses Riley’s edited brief (${day('2026-10-14T15:00:00.000Z')}).`)).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\$|USD|Claude|Codex|model/i);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Generate 2 drafts' }));
    await waitFor(() => expect(services.createAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-toolkit-1' }, deliverableIds: ['blogshort', 'bloglong'] }));
    expect(action).toHaveBeenCalledWith(expect.any(Function), '', true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Starting soon…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Generating 2 drafts for Semrush Blog. You’ll see progress on this card.');
    // The button that opened the sheet is now a progress bar, so focus lands on the card's heading.
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'AI Overviews' })).toHaveFocus());
    expect(trigger).not.toBeInTheDocument();
  });

  it('keeps a Codex-shaped plan to this channel’s files and never shows its route, model or estimate', async () => {
    const codexPlan = { title: 'AI Overviews', route: 'codex', minutes: 6, imagesReady: true, estimate: { totalUsd: 3.2, capUsd: 10, calls: 5, modelLabel: 'Codex' },
      folders: [{ id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', selected: true, available: true, usd: 0.6 }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', selected: true, available: true, usd: 1.4 }] }, { id: 'social', name: 'Semrush Social Team', items: [{ id: 'social', label: 'Social Team — Captions', kind: 'text', selected: true, available: true, usd: 0.5 }] }] };
    expect(channelPlan(codexPlan, channel).items.map((item) => item.id)).toEqual(['blogshort', 'bloglong']);
    render(<ChannelGenerateSheet api={api({ planAssetKit: vi.fn(async () => codexPlan) })} trend={trend()} channel={channel} viewer={viewer()} onClose={() => {}} />);
    const sheet = screen.getByRole('dialog');
    expect(await within(sheet).findByText('Long-form Article')).toBeInTheDocument();
    expect(within(sheet).queryByText('Captions')).not.toBeInTheDocument();
    expect(within(sheet).getByText('About 6 minutes')).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\$|3\.20|Codex|plan/i);
    expect(within(sheet).getByRole('button', { name: 'Generate 2 drafts' })).toBeEnabled();
  });

  it('keeps the sheet open with the reason when the set can’t start', async () => {
    const services = api({ createAssetKit: vi.fn(async () => { throw new Error('Your Semrush Blog assets for this trend are already being made.'); }) });
    render(<ChannelGenerateSheet api={services} trend={trend()} channel={channel} viewer={viewer()} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate 2 drafts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your Semrush Blog assets for this trend are already being made.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ChannelTrends: answers', () => {
  it('answers optimistically, moves focus to the next card, and Undo puts the card back', async () => {
    const services = api();
    const trends = [trend(), trend({ themeId: 'theme-2', name: 'Zero-click search', readyAt: now })];
    render(<ChannelTrends api={services} view={view(trends)} viewer={viewer()} />);
    expect(screen.getByRole('button', { name: /New/, pressed: true })).toHaveTextContent('2');
    const first = card('AI Overviews');
    const group = within(first).getByRole('group', { name: 'Using this trend for Semrush Blog?' });
    fireEvent.click(within(group).getByRole('button', { name: /Yes, I’m using this trend/ }));
    expect(services.setTrendAdoption).toHaveBeenCalledWith({ themeId: 'theme-1', status: 'using', link: '', note: '' });
    expect(screen.queryByRole('article', { name: 'AI Overviews' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Zero-click search'));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Marked as used.');
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(services.setTrendAdoption).toHaveBeenLastCalledWith({ themeId: 'theme-1', status: 'clear' }));
    expect(card('AI Overviews')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('AI Overviews'));
  });

  it('marks Not for us with its own toast, and rolls back when the save fails', async () => {
    const services = api({ setTrendAdoption: vi.fn(async () => { throw new Error('This trend isn’t ready in this workspace.'); }) });
    render(<ChannelTrends api={services} view={view([trend(), trend({ themeId: 'theme-2', name: 'Zero-click search' })])} viewer={viewer()} />);
    fireEvent.click(within(card('AI Overviews')).getByRole('button', { name: 'Not for us' }));
    expect(screen.getByRole('status')).toHaveTextContent('Marked Not for us.');
    expect(await screen.findByRole('alert')).toHaveTextContent('This trend isn’t ready in this workspace.');
    expect(card('AI Overviews')).toBeInTheDocument();
  });

  it('asks for the link only when it’s live, refuses things that aren’t links, and adds https to bare domains', async () => {
    const services = api();
    render(<ChannelTrends api={services} view={view([trend({ adoption: { status: 'using', link: '', note: '', at: now, byName: 'Alex Smith', byMe: true }, isNew: false })])} viewer={viewer()} />);
    expect(within(card('AI Overviews')).getByText('Using')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Using this trend for Semrush Blog?' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add the link when it’s live/ }));
    const field = screen.getByLabelText('Where did you use it?');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'semrush.com/blog/…');
    expect(screen.getByText('Paste the post, page or email link. You can add it later.')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'our blog post' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That doesn’t look like a web link.');
    expect(services.setTrendAdoption).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'semrush.com/blog/ai-overviews' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(services.setTrendAdoption).toHaveBeenCalledWith({ themeId: 'theme-1', status: 'using', link: 'https://semrush.com/blog/ai-overviews', note: '' });
    const chip = await screen.findByRole('button', { name: /semrush\.com\/blog\/ai-overviews/ });
    await waitFor(() => expect(chip).toHaveFocus());
    fireEvent.click(chip);
    expect(services.openSourceUrl).toHaveBeenCalledWith('https://semrush.com/blog/ai-overviews');
  });

  it('shows who answered when it was another owner of the channel', () => {
    render(<ChannelTrends api={api()} view={view([trend({ adoption: { status: 'not-using', link: '', note: '', at: '2026-10-12T10:00:00.000Z', byName: 'Pat Lee', byMe: false }, isNew: false })])} viewer={viewer()} />);
    expect(screen.getByText(`Answered by Pat Lee · ${day('2026-10-12T10:00:00.000Z')}`)).toBeInTheDocument();
  });

  it('lets the owner change a saved link or their answer from the “…” menu', () => {
    const services = api();
    render(<ChannelTrends api={services} view={view([trend({ adoption: { status: 'using', link: 'https://www.semrush.com/blog/ai/', note: '', at: now, byName: 'Alex Smith', byMe: true }, isNew: false })])} viewer={viewer()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for “AI Overviews”' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change my answer' }));
    const no = screen.getByRole('button', { name: 'Not for us' });
    fireEvent.click(no);
    expect(services.setTrendAdoption).toHaveBeenCalledWith({ themeId: 'theme-1', status: 'not-using', link: '', note: '' });
  });
});

describe('ChannelTrends: preview, groups and empty states', () => {
  it('turns every write button off in a preview, with the reason as its title', () => {
    render(<ChannelTrends api={api()} view={view([trend(), trend({ themeId: 'theme-2', name: 'Zero-click search', latestRun: run({ status: 'succeeded' }) })])} viewer={viewer({ preview: true, realRole: 'admin', prefs: {} })} />);
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument();
    const generate = screen.getByRole('button', { name: /Generate for my channel/ });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title', PREVIEW_TITLE);
    const writes = screen.getAllByRole('article').flatMap((article) => within(article).getAllByRole('button', { name: /Yes, I’m using this trend|Not for us|Generate a new set/ }));
    expect(writes).toHaveLength(5);
    for (const button of writes) { expect(button).toBeDisabled(); expect(button).toHaveAttribute('title', PREVIEW_TITLE); }
    // Reading and the filters stay on.
    expect(screen.getByRole('button', { name: /^All/ })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /Read the brief/ })[0]).toBeEnabled();
    expect(screen.getByRole('button', { name: /Open my assets/ })).toBeEnabled();
  });

  it('follows an Earlier trend with focus when answering moves it into the list', async () => {
    render(<ChannelTrends api={api()} view={view([trend(), trend({ themeId: 'theme-old', name: 'Old news', readyAt: '2026-06-01T00:00:00.000Z', isNew: false, earlier: true })])} viewer={viewer()} />);
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.click(screen.getByRole('button', { name: /Earlier/ }));
    fireEvent.click(within(card('Old news')).getByRole('button', { name: 'Not for us' }));
    const heading = await screen.findByRole('heading', { level: 3, name: 'Old news' });
    expect(heading.closest('#channel-earlier-list')).toBeNull();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('keeps trends from before the owner joined in a collapsed Earlier group', () => {
    render(<ChannelTrends api={api()} view={view([trend(), trend({ themeId: 'theme-old', name: 'Old news', readyAt: '2026-06-01T00:00:00.000Z', isNew: false, earlier: true })])} viewer={viewer()} />);
    expect(screen.getByRole('button', { name: /New/, pressed: true })).toHaveTextContent('1');
    const toggle = screen.getByRole('button', { name: /Earlier/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('These came in before you joined. Answer them if you like.')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Old news' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(card('Old news')).toBeInTheDocument();
  });

  it('says why a list is empty: nothing yet, everything answered, or an empty filter', () => {
    const { rerender } = render(<ChannelTrends api={api()} view={view([])} viewer={viewer()} />);
    expect(screen.getByText('No trends yet. When the team approves a trend and its brief is written, it shows up here.')).toBeInTheDocument();
    rerender(<ChannelTrends api={api()} view={view([trend({ adoption: { status: 'not-using', link: '', note: '', at: now, byName: 'Alex Smith', byMe: true }, isNew: false })])} viewer={viewer()} />);
    expect(screen.getByRole('button', { name: /All/, pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    expect(screen.getByText('You’ve answered every trend. New ones show up here, and the count next to Trends tells you when.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Using/ }));
    expect(screen.getByText('You haven’t marked any trends as used yet.')).toBeInTheDocument();
  });

  it('welcomes a new owner inline until they press Got it', () => {
    const onPrefs = vi.fn();
    render(<ChannelTrends api={api()} view={view([trend()])} viewer={viewer({ prefs: {} })} onPrefs={onPrefs} />);
    expect(screen.getByRole('heading', { name: 'Welcome, Alex. This is where trends for Semrush Blog land.' })).toBeInTheDocument();
    expect(screen.getByText('Generate drafts for your channel if it fits.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onPrefs).toHaveBeenCalledWith({ welcomedAt: expect.any(String) });
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument();
  });

  it('reads the brief in a dialog that closes on Esc and gives focus back', async () => {
    const services = api();
    render(<ChannelTrends api={services} view={view([trend({ briefEditedAt: '2026-10-14T15:00:00.000Z' })])} viewer={viewer()} />);
    const read = screen.getByRole('button', { name: /Read the brief/ });
    read.focus();
    fireEvent.click(read);
    const dialog = await screen.findByRole('dialog', { name: 'AI Overviews' });
    expect(await within(dialog).findByText('Body of asset-toolkit-1.')).toBeInTheDocument();
    expect(within(dialog).getByText(`Edited by Riley · ${day('2026-10-14T15:00:00.000Z')}`)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(read).toHaveFocus();
  });
});

describe('ChannelAssets', () => {
  const assets = [{ id: 'asset-short', runId: 'kit-1', themeId: 'theme-1', deliverableId: 'blogshort', title: 'AI Overviews change the click', kind: 'text', format: 'md', createdAt: now, variantIndex: null, edited: null }];
  const done = run({ status: 'succeeded', progress: { done: 1, total: 2 }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'succeeded', assetId: 'asset-short', assetIds: [] }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text', status: 'failed', assetId: '', assetIds: [] }] });

  it('groups sets by trend with the answer row, reads a draft, and saves the folder', async () => {
    const services = api();
    render(<ChannelAssets api={services} web={false} view={view([trend()], { runs: [done], assets })} viewer={viewer()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'My assets · Semrush Blog' })).toBeInTheDocument();
    const group = screen.getByRole('region', { name: 'AI Overviews' });
    expect(within(group).getByRole('group', { name: 'Using this trend for Semrush Blog?' })).toBeInTheDocument();
    const set = within(group).getByRole('article', { name: `Set from ${day(done.createdAt)}` });
    fireEvent.click(within(set).getByRole('button', { name: /Save folder/ }));
    await waitFor(() => expect(services.saveAssetKitFolder).toHaveBeenCalledWith({ runId: 'kit-1' }));
    expect(await screen.findByText('Saved to your Downloads folder.')).toBeInTheDocument();
    fireEvent.click(within(set).getByRole('button', { name: 'Open Short News Update' }));
    const reader = await screen.findByRole('dialog', { name: 'AI Overviews change the click' });
    expect(await within(reader).findByText('Body of asset-short.')).toBeInTheDocument();
    fireEvent.click(within(reader).getByRole('button', { name: /Open/ }));
    await waitFor(() => expect(services.openStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-short' }));
    expect(within(set).getByRole('button', { name: /Long-form Article/ })).toBeDisabled();
  });

  it('says a shared set was made with other channels and offers Download folder on the web', () => {
    render(<ChannelAssets api={api()} web view={view([trend()], { runs: [{ ...done, shared: true }], assets })} viewer={viewer()} />);
    expect(screen.getByText('Made with other channels.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download folder/ })).toBeEnabled();
  });

  it('says where each unfinished set can be finished, in step with the Trends card', () => {
    const failed = (id, createdAt, over = {}) => run({ id, status: 'failed', createdAt, progress: { done: 0, total: 1 }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'failed', assetId: '', assetIds: [] }], ...over });
    const card = failed('kit-new', '2026-10-15T10:00:00.000Z');
    const runs = [card, failed('kit-old', '2026-10-11T10:00:00.000Z'), failed('kit-shared', '2026-10-13T10:00:00.000Z', { shared: true }), failed('kit-key', '2026-10-12T10:00:00.000Z', { needsAdmin: true, message: 'Ask an admin: the AI connection needs attention.' })];
    render(<ChannelAssets api={api()} view={view([trend({ latestRun: card })], { runs, assets: [] })} viewer={viewer()} />);
    const line = (iso) => within(screen.getByRole('article', { name: `Set from ${day(iso)}` })).getByText(/ready/).textContent;
    expect(line('2026-10-15T10:00:00.000Z')).toBe('0 of 1 ready · finish the rest on Trends');
    expect(line('2026-10-11T10:00:00.000Z')).toBe('0 of 1 ready');
    expect(line('2026-10-13T10:00:00.000Z')).toBe('0 of 1 ready · ask an editor to finish it');
    expect(line('2026-10-12T10:00:00.000Z')).toBe('0 of 1 ready · Ask an admin: the AI connection needs attention.');
  });

  it('leaves out a set someone stopped before it made anything', () => {
    const stopped = run({ id: 'kit-stopped', status: 'cancelled', createdAt: '2026-10-14T10:00:00.000Z', progress: { done: 0, total: 2 }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'cancelled', assetId: '', assetIds: [] }] });
    render(<ChannelAssets api={api()} view={view([trend()], { runs: [done, stopped], assets })} viewer={viewer()} />);
    expect(screen.getByRole('article', { name: `Set from ${day(done.createdAt)}` })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: `Set from ${day(stopped.createdAt)}` })).not.toBeInTheDocument();
  });

  it('shows a loading state until the channel view arrives', () => {
    render(<><ChannelTrends api={api()} viewer={viewer()} /><ChannelAssets api={api()} viewer={viewer()} /></>);
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(2);
    expect(screen.queryByText(/No trends yet/)).not.toBeInTheDocument();
  });

  it('focuses the trend it was opened for, and has a plain empty state', () => {
    const { rerender } = render(<ChannelAssets api={api()} view={view([trend()], { runs: [done], assets })} viewer={viewer()} focusThemeId="theme-1" />);
    expect(screen.getByRole('heading', { level: 2, name: 'AI Overviews' })).toHaveFocus();
    // Once: a new set arriving later doesn't pull focus back.
    screen.getByRole('heading', { level: 1, name: 'My assets · Semrush Blog' }).setAttribute('tabindex', '-1');
    screen.getByRole('heading', { level: 1, name: 'My assets · Semrush Blog' }).focus();
    const other = run({ id: 'kit-other', status: 'succeeded', kit: { sourceTitle: 'Other', themeId: 'theme-2', folderName: 'x', reportAssetId: 'r' } });
    rerender(<ChannelAssets api={api()} view={view([trend()], { runs: [done, other], assets })} viewer={viewer()} focusThemeId="theme-1" />);
    expect(screen.getByRole('heading', { level: 1, name: 'My assets · Semrush Blog' })).toHaveFocus();
    rerender(<ChannelAssets api={api()} view={view([trend()])} viewer={viewer()} />);
    expect(screen.getByText('No drafts yet. On Trends, choose a trend and press Generate for my channel.')).toBeInTheDocument();
  });

  it('loads picture thumbnails once and opens them in a lightbox', async () => {
    const pictures = [{ id: 'img-1', runId: 'kit-2', themeId: 'theme-1', deliverableId: 'brand-image', title: 'Hero 1', kind: 'image', format: 'png', createdAt: now, variantIndex: 0, edited: null }];
    const social = run({ id: 'kit-2', status: 'succeeded', jobs: [{ id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', status: 'succeeded', assetId: '', assetIds: ['img-1'] }] });
    const onCache = vi.fn();
    const services = api({ readStudioAsset: vi.fn(async () => ({ asset: { id: 'img-1' }, imageDataUrl: 'data:image/png;base64,AAAA' })) });
    render(<ChannelAssets api={services} view={view([trend()], { runs: [social], assets: pictures })} viewer={viewer()} cache={{}} onCache={onCache} />);
    await waitFor(() => expect(onCache).toHaveBeenCalledWith('studio:img-1', 'data:image/png;base64,AAAA'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Hero 1' }));
    expect(screen.getByRole('dialog', { name: 'Hero 1' })).toBeInTheDocument();
  });

  it('asks for each thumbnail once, even as the ones that arrive shorten the list', async () => {
    const pictures = Array.from({ length: 6 }, (_, index) => ({ id: `img-${index}`, runId: 'kit-2', themeId: 'theme-1', deliverableId: 'brand-image', title: `Hero ${index}`, kind: 'image', format: 'png', createdAt: now, variantIndex: index, edited: null }));
    const social = run({ id: 'kit-2', status: 'succeeded', jobs: [{ id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', status: 'succeeded', assetId: '', assetIds: pictures.map((row) => row.id) }] });
    const reads = {};
    const readStudioAsset = vi.fn(async ({ assetId }) => { reads[assetId] = (reads[assetId] || 0) + 1; await new Promise((resolve) => setTimeout(resolve, assetId.endsWith('0') ? 5 : 30)); return { asset: { id: assetId }, imageDataUrl: `data:image/png;base64,${assetId}` }; });
    function Host() { const [cache, setCache] = React.useState({}); return <ChannelAssets api={{ ...api(), readStudioAsset }} view={view([trend()], { runs: [social], assets: pictures })} viewer={viewer()} cache={cache} onCache={(key, url) => setCache((current) => ({ ...current, [key]: url }))} />; }
    render(<Host />);
    await waitFor(() => expect(document.querySelectorAll('.channel-thumb img')).toHaveLength(6));
    expect(reads).toEqual(Object.fromEntries(pictures.map((row) => [row.id, 1])));
  });
});

describe('links', () => {
  it('adds https to bare domains and refuses anything that isn’t a web link', () => {
    expect(normalizeLink('semrush.com/blog/x')).toBe('https://semrush.com/blog/x');
    expect(normalizeLink(' https://www.semrush.com/blog/ ')).toBe('https://www.semrush.com/blog/');
    // Written as the server stores it (URL.href), so an answer shown before the save matches the saved one.
    expect(normalizeLink('semrush.com')).toBe('https://semrush.com/');
    expect(normalizeLink('https://www.Semrush.com/Blog')).toBe('https://www.semrush.com/Blog');
    expect(normalizeLink('semrush.com/café')).toBe('https://semrush.com/caf%C3%A9');
    for (const bad of ['', 'our post', 'javascript:alert(1)', 'mailto:pat@semrush.com', 'http://intranet', 'ftp://semrush.com/x']) expect(normalizeLink(bad)).toBe('');
    expect(linkLabel('https://www.semrush.com/blog/ai-overviews/')).toBe('semrush.com/blog/ai-overviews/');
  });
});
