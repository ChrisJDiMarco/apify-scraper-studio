// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchView } from '../src/renderer/src/search-view.jsx';

beforeEach(() => {
  const values = new Map();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), clear: () => values.clear() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = (overrides = {}) => ({ state: { keys: { APIFY_API_TOKEN: true }, datasets: [], recipes: [], apifyCatalog: { actors: [{ fullName: 'trudax/reddit-scraper-lite' }], syncedAt: '2026-09-27T12:00:00Z' } }, onSearch: vi.fn(async () => ({ datasets: [] })), onNavigate: vi.fn(), onRefreshActors: vi.fn(async () => true), ...overrides });
const step = (label) => fireEvent.click(screen.getByRole('tab', { name: label, exact: true }));
const fill = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });
const check = (id) => fireEvent.click(document.getElementById(id));
const topic = (value = 'marketing analytics') => fill('search-query', value);
const run = () => { step('Review & run'); fireEvent.click(screen.getByRole('button', { name: 'Search selected sources' })); };
const selectOnly = (ids) => {
  step('Search brief');
  for (const id of ['reddit', 'x', 'linkedin-search', 'linkedin-profile']) {
    const input = document.getElementById(`search-source-${id}`);
    if (input.checked !== ids.includes(id)) fireEvent.click(input);
  }
};
const filters = (source = 'Reddit') => { step('Sources & filters'); fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${source.replace('/', '\\/')}`) })); };
const readyPlan = { valid: true, plan: { recipes: [], totalRequestedPosts: 30, totalRequestedItems: 30, totalMaxChargeUsd: 0.75, requestedSourceCount: 3 } };

describe('guided source search', () => {
  it('starts with a readable brief and accessible setup tabs, with no paid run on the first steps', () => {
    const handlers = props(); render(<SearchView {...handlers} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Search brief' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByRole('checkbox', { name: 'Reddit' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'LinkedIn accounts' })).not.toBeChecked();
    expect(screen.getByText('In your Apify')).toBeVisible();
    expect(screen.getAllByText('Not in recent Actors')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Search selected sources' })).not.toBeInTheDocument();
    topic(); fireEvent.submit(document.querySelector('.search-form'));
    expect(screen.getByRole('tab', { name: 'Sources & filters' })).toHaveAttribute('aria-selected', 'true');
    expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('supports keyboard navigation on both tab lists', () => {
    render(<SearchView {...props()} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Search brief' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Sources & filters' })).toHaveFocus();
    const sourceTabs = within(screen.getByRole('tablist', { name: 'Source filters' })).getAllByRole('tab');
    fireEvent.keyDown(sourceTabs[0], { key: 'ArrowRight' });
    expect(sourceTabs[1]).toHaveFocus();
    expect(sourceTabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('X accounts')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sources & filters' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Review & run' })).toHaveFocus();
  });

  it('submits the explicit source options and provides a direct findings handoff', async () => {
    const handlers = props({ onSearch: vi.fn(async () => ({ datasets: [{ id: 'results-1', name: 'Reddit · Analytics', itemCount: 5, platform: 'reddit' }] })) });
    render(<SearchView {...handlers} />); topic(); filters();
    fill('search-reddit-subreddits', 'r/marketing\nr/SaaS');
    fill('search-reddit-time', 'month'); check('search-reddit-includeComments'); fill('search-reddit-maxComments', '3');
    run(); await waitFor(() => expect(handlers.onSearch).toHaveBeenCalledOnce());
    expect(handlers.onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'marketing analytics', platformIds: ['reddit', 'x', 'linkedin-search'], maxItems: 10, maxTotalChargeUsd: 0.25, sourceOptions: expect.objectContaining({ reddit: expect.objectContaining({ subreddits: 'r/marketing\nr/SaaS', time: 'month', includeComments: true, maxComments: '3' }) }) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review findings' }));
    expect(handlers.onNavigate).toHaveBeenCalledWith('chat', { datasetId: 'results-1' });
  });

  it('supports a target-only cross-source collection without requiring a topic', async () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['reddit', 'x', 'linkedin-profile']);
    filters(); fill('search-reddit-subreddits', 'r/SaaS');
    filters('X / Twitter'); fill('search-x-handles', '@OpenAI');
    filters('LinkedIn accounts'); fill('search-linkedin-profile-urls', 'https://www.linkedin.com/company/apify');
    expect(screen.getByText(/Your topic does not filter them/)).toBeVisible();
    run(); await waitFor(() => expect(handlers.onSearch).toHaveBeenCalledOnce());
    expect(handlers.onSearch.mock.calls[0][0].query).toBe('');
    expect(handlers.onSearch.mock.calls[0][0].sourceOptions['linkedin-profile'].urls).toContain('/company/apify');
  });

  it('requires the LinkedIn keyword topic and focuses its owning tab', async () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['linkedin-search']); run();
    expect(handlers.onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('LinkedIn search needs a topic');
    expect(screen.getByRole('tab', { name: 'Search brief' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.getElementById('search-query')).toHaveFocus());
  });

  it('requires account targets and reveals the account editor when they are missing', async () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['linkedin-profile']); run();
    expect(handlers.onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one LinkedIn profile or company URL');
    expect(screen.getByRole('tab', { name: 'Sources & filters' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('LinkedIn profile or company URLs')).toHaveFocus());
  });

  it('distinguishes Reddit matching-comment pages from attached thread comments and their dates', () => {
    render(<SearchView {...props()} />); selectOnly(['reddit']); topic(); filters();
    fireEvent.click(screen.getByText('More Reddit options')); check('search-reddit-searchComments');
    expect(screen.getByLabelText('Comments per page')).toBeVisible();
    expect(screen.queryByLabelText('Reddit comments after')).not.toBeInTheDocument();
    step('Review & run'); expect(screen.getByText(/matching comments \(up to 5\/page\)/)).toBeVisible();
    filters(); check('search-reddit-includeComments');
    expect(screen.getByLabelText('Comments per post')).toBeVisible();
    expect(screen.getByLabelText('Reddit comments after')).toBeInTheDocument();
  });

  it('sends the exact X account/date/reply/media choices and rejects reversed dates', async () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['x']); filters('X / Twitter');
    fill('search-x-handles', '@OpenAI\nhttps://x.com/apify'); fill('search-x-startDate', '2026-09-01'); fill('search-x-endDate', '2026-08-01');
    run(); expect(screen.getByRole('alert')).toHaveTextContent('end date on or after');
    await waitFor(() => expect(screen.getByLabelText('X end date')).toHaveFocus());
    fill('search-x-endDate', '2026-09-27'); fill('search-x-replies', 'only');
    fireEvent.click(screen.getByText('More X options')); fill('search-x-media', 'links'); check('search-x-includeRetweets');
    run(); await waitFor(() => expect(handlers.onSearch).toHaveBeenCalledOnce());
    expect(handlers.onSearch.mock.calls[0][0].sourceOptions.x).toEqual(expect.objectContaining({ handles: '@OpenAI\nhttps://x.com/apify', startDate: '2026-09-01', endDate: '2026-09-27', replies: 'only', media: 'links', includeRetweets: false }));
  });

  it('keeps LinkedIn relative and exact dates mutually exclusive without changing the result limit', async () => {
    render(<SearchView {...props()} />); selectOnly(['linkedin-profile']); filters('LinkedIn accounts');
    fill('search-linkedin-profile-urls', 'https://www.linkedin.com/company/apify');
    fill('search-linkedin-profile-postedLimit', 'month'); fill('search-linkedin-profile-startDate', '2026-09-01');
    expect(screen.getByLabelText('LinkedIn profile time window')).toHaveValue('any');
    fill('search-linkedin-profile-postedLimit', 'week');
    expect(screen.getByLabelText('LinkedIn profile earliest date')).toHaveValue('');
    expect(screen.queryByLabelText(/end date/i)).not.toBeInTheDocument();
    step('Review & run'); expect(screen.getByLabelText('Results per source')).toHaveValue(10);
  });

  it('shows the Reddit minimum and never silently raises a chosen result limit', () => {
    const handlers = props(); render(<SearchView {...handlers} />); topic(); selectOnly(['x']); step('Review & run');
    fill('search-max-items', '2'); expect(screen.getByLabelText('Results per source')).toHaveAttribute('min', '1');
    step('Search brief'); check('search-source-reddit'); step('Review & run');
    expect(screen.getByLabelText('Results per source')).toHaveValue(2);
    expect(screen.getByLabelText('Results per source')).toHaveAttribute('min', '10');
    expect(screen.getByText(/Reddit requires a request for at least 10/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Search selected sources' }));
    expect(screen.getByRole('alert')).toHaveTextContent('10–50 results'); expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('shows separate LinkedIn engagement limits and rejects zero as unlimited', async () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['linkedin-profile']); filters('LinkedIn accounts');
    fill('search-linkedin-profile-urls', 'https://www.linkedin.com/company/apify'); check('search-linkedin-profile-includeComments'); fill('search-linkedin-profile-maxComments', '0');
    run(); expect(screen.getByRole('alert')).toHaveTextContent('1–100 comments per post'); expect(handlers.onSearch).not.toHaveBeenCalled();
    fill('search-linkedin-profile-maxComments', '2'); fireEvent.click(screen.getByText('More LinkedIn profile options')); check('search-linkedin-profile-includeReactions'); fill('search-linkedin-profile-maxReactions', '3');
    step('Review & run'); expect(screen.getByText(/Up to 50 additional engagement rows; 60 total rows/)).toBeVisible();
    expect(screen.getByText('$0.25')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Search selected sources' })); await waitFor(() => expect(handlers.onSearch).toHaveBeenCalledOnce());
  });

  it('validates subreddit, X and LinkedIn target formats before calling a paid handler', () => {
    const handlers = props(); render(<SearchView {...handlers} />); selectOnly(['reddit']); topic(); filters(); fill('search-reddit-subreddits', 'https://example.com/r/marketing'); run();
    expect(screen.getByRole('alert')).toHaveTextContent('Use subreddit names');
    expect(handlers.onSearch).not.toHaveBeenCalled();
    fill('search-reddit-subreddits', Array.from({ length: 21 }, (_, i) => `sub${i}`).join('\n')); run();
    expect(screen.getByRole('alert')).toHaveTextContent('20 targets or fewer');
  });

  it('checks the authoritative plan again immediately before a paid call', async () => {
    const handlers = props({ onPreviewSearch: vi.fn(async () => readyPlan) }); render(<SearchView {...handlers} />); topic(); step('Review & run');
    await screen.findByText(/Plan checked/); const prior = handlers.onPreviewSearch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Search selected sources' }));
    await waitFor(() => expect(handlers.onSearch).toHaveBeenCalledOnce());
    expect(handlers.onPreviewSearch).toHaveBeenCalledTimes(prior + 1);
    expect(handlers.onPreviewSearch.mock.calls.at(-1)[0]).toEqual(handlers.onSearch.mock.calls[0][0]);
  });

  it('keeps canonical target prefixes and exact account URLs visible in the reviewed plan', async () => {
    const plan = { ...readyPlan.plan, recipes: [
      { searchContext: { sourceId: 'reddit', sourceOptions: { subreddits: ['marketing', 'SaaS'], time: 'all' }, maxItems: 10, maxResultItems: 10, warnings: [] } },
      { searchContext: { sourceId: 'x', sourceOptions: { handles: ['apify', 'NASA'], conversationUrls: [], replies: 'all', media: 'all', sort: 'Latest' }, maxItems: 10, maxResultItems: 10, warnings: [] } },
      { searchContext: { sourceId: 'linkedin-profile', sourceOptions: { urls: ['https://www.linkedin.com/company/apify'], postedLimit: 'any' }, maxItems: 10, maxResultItems: 10, warnings: [] } },
    ] };
    render(<SearchView {...props({ onPreviewSearch: vi.fn(async () => ({ valid: true, plan })) })} />);
    selectOnly(['reddit', 'x', 'linkedin-profile']); topic(); step('Review & run');
    await screen.findByText(/Plan checked/);
    expect(screen.getByText('r/marketing, r/SaaS')).toBeVisible();
    expect(screen.getByText('@apify, @NASA')).toBeVisible();
    expect(screen.getByText('https://www.linkedin.com/company/apify')).toBeVisible();
  });

  it('reveals a precise backend validation field without starting a run', async () => {
    const handlers = props({ onPreviewSearch: vi.fn(async () => ({ valid: false, error: { field: 'sourceOptions.x.handles', message: 'This account target is not valid.' } })) });
    render(<SearchView {...handlers} />); topic(); run();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This account target is not valid'));
    await waitFor(() => expect(screen.getByLabelText('X accounts')).toHaveFocus()); expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('persists the nonsecret draft across navigation, preserves deselected filters, and can reset it', () => {
    const first = render(<SearchView {...props()} />); topic('persistent research'); filters(); fill('search-reddit-subreddits', 'r/SaaS');
    selectOnly(['x']); first.unmount();
    render(<SearchView {...props()} />);
    expect(document.getElementById('search-query')).toHaveValue('persistent research');
    expect(screen.getByRole('checkbox', { name: 'Reddit' })).not.toBeChecked(); check('search-source-reddit'); filters();
    expect(screen.getByLabelText('Subreddits')).toHaveValue('r/SaaS');
    expect(screen.getByText('Draft saved on this Mac')).toBeVisible();
    const stored = JSON.parse(window.localStorage.getItem('apify-studio.search-draft.v2'));
    expect(Object.keys(stored).sort()).toEqual(['budget', 'maxItems', 'platformIds', 'query', 'sourceOptions']);
    fireEvent.click(screen.getByRole('button', { name: 'Reset draft' }));
    expect(document.getElementById('search-query')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Reddit' })).toBeChecked();
  });

  it('continues safely if browser draft storage is unavailable', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<SearchView {...props()} />); expect(screen.getByText('Draft kept for this visit')).toBeVisible(); topic(); step('Review & run');
    expect(screen.getByRole('button', { name: 'Search selected sources' })).toBeEnabled();
  });

  it('preserves a failed request for retry and displays partial-source errors', async () => {
    const handlers = props({ onSearch: vi.fn().mockRejectedValueOnce(new Error('Apify connection failed')).mockResolvedValueOnce({ datasets: [], errors: [{ sourceId: 'x', message: 'No results available' }] }) });
    render(<SearchView {...handlers} />); topic('analytics'); run();
    expect(await screen.findByRole('alert')).toHaveTextContent('Apify connection failed');
    expect(document.getElementById('search-query')).toHaveValue('analytics');
    fireEvent.click(screen.getByRole('button', { name: 'Search selected sources' }));
    expect(await screen.findByText('No collections returned from this search.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('X / Twitter: No results available');
  });

  it('requires an Apify connection before the paid action and routes settings', () => {
    const handlers = props({ state: { keys: {} } }); render(<SearchView {...handlers} />); step('Review & run');
    expect(screen.getByRole('button', { name: 'Search selected sources' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Apify' }));
    expect(handlers.onNavigate).toHaveBeenCalledWith('settings'); expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('locks inputs and prevents duplicate actions while collection is in flight', async () => {
    let done; const handlers = props({ onSearch: vi.fn(() => new Promise((resolve) => { done = resolve; })) });
    render(<SearchView {...handlers} />); topic(); run();
    expect(screen.getByRole('button', { name: 'Collecting posts…' })).toBeDisabled();
    expect(document.getElementById('search-query')).toBeDisabled();
    fireEvent.submit(document.querySelector('.search-form')); expect(handlers.onSearch).toHaveBeenCalledOnce();
    done({ datasets: [] }); expect(await screen.findByText('No collections returned from this search.')).toBeVisible();
  });
});
