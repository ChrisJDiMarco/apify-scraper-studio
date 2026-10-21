// @vitest-environment jsdom
import './helpers/prosemirror-dom.js';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { channelAskRunner, channelNeeds, channelStarters } from '../src/renderer/src/channel-ask.jsx';
import { PREVIEW_TITLE, formatDay } from '../src/renderer/src/viewer.js';
import roles from '../src/main/roles.js';
import fixture from './fixtures/roles-state.js';

// Ask AI in the channel owner's layout, against the real policy: viewers from roles.buildViewer and state from
// roles.projectState, exactly as the main process sends them.
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* no storage */ } });
const admins = [{ id: 'member-chris', name: 'Chris' }];
const identities = {
  admin: { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' },
  channel: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', memberSince: fixture.at('10-01') },
};
const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' });
const askButton = () => within(sidebar()).queryByRole('button', { name: /^Ask AI/ });

function openStudio(who, { viewAs = null, policy = null, access = null, api: extra = {} } = {}) {
  const server = { who, viewAs, prefs: { uiMode: 'simple', welcomedAt: '2026-10-01T00:00:00.000Z' }, base: fixture.baseState() };
  const project = () => {
    const viewer = roles.buildViewer({ identity: identities[server.who], session: { viewAs: server.viewAs }, prefs: server.prefs, editionId: 'semrush', web: false, admins, policy, access });
    return roles.projectState(server.base, viewer, { adoptions: fixture.adoptions(), admins, memberCount: 5, editionId: 'semrush' });
  };
  const api = {
    appMeta: vi.fn(async () => ({ version: '0.3.0' })), state: vi.fn(async () => project()), onStateChanged: vi.fn(() => () => {}),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), readDataset: vi.fn(async () => ({ items: [] })),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ markdown: `# Brief ${assetId}\n\nText.` })), setViewPrefs: vi.fn(async () => ({})),
    setViewAs: vi.fn(async (payload) => { server.viewAs = payload.role === 'admin' ? null : payload; return { viewer: project().viewer }; }),
    setTrendAdoption: vi.fn(async () => ({ adoption: null })), openSourceUrl: vi.fn(async () => true), getTeam: vi.fn(async () => ({ members: [], channels: [], signIn: { web: false } })),
    askHelp: vi.fn(async () => ({ answer: 'Here is what’s new for Blog.', pages: [], followUps: [], actions: [] })),
    listAskConversations: vi.fn(async () => ({ conversations: [] })), readAskConversation: vi.fn(async () => ({ conversation: { messages: [] } })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  return { api, server, project };
}

describe('Ask AI in the channel layout', () => {
  it('sits in a channel owner’s sidebar with its ⌘J key, opens as a page about their channel, and asks from it', async () => {
    const { api } = openStudio('channel');
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    const button = askButton();
    expect(button).toBeInTheDocument();
    expect(button.querySelector('kbd')).toHaveTextContent(/^(⌘J|Ctrl\+J)$/);
    expect(button).toHaveAttribute('aria-keyshortcuts', expect.stringMatching(/^(Meta|Control)\+J$/));
    // The pages stay the four channel pages; Ask AI is with the actions, as in Simple.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('button').map((row) => row.textContent.replace(/\d+$/, ''))).toEqual(['Trends', 'My assets', 'My plan', 'Inbox']);
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Ask about the trends for Semrush Blog, your drafts and your plan/)).toBeInTheDocument();
    expect(screen.getByText('Saved for you only. AI can be mistaken.')).toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    const needs = screen.getByRole('group', { name: 'Needs you now' });
    expect(within(needs).getByRole('button', { name: /new trend for Semrush Blog: say if you’re using it/ })).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Question about Golden Thread' });
    fireEvent.change(box, { target: { value: 'What’s new for my channel?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(api.askHelp).toHaveBeenCalledTimes(1));
    expect(api.askHelp.mock.calls[0][0]).toMatchObject({ question: 'What’s new for my channel?', page: { id: 'channel', label: 'Semrush Blog', layout: 'channel', tab: 'trends' } });
    expect(await screen.findByText('Here is what’s new for Blog.')).toBeInTheDocument();
    // A "Needs you now" button takes them to the page it names.
    fireEvent.click(within(sidebar()).getByRole('button', { name: /My assets/ }));
    await screen.findByRole('heading', { level: 1, name: 'My assets · Semrush Blog' });
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
  });

  it('is in the bar along the bottom on a phone too', async () => {
    window.matchMedia = vi.fn((query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      openStudio('channel');
      await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
      const bottom = document.querySelector('.studio-bottom-nav');
      const ask = within(bottom).getByRole('button', { name: 'Ask AI' });
      expect(within(bottom).getAllByRole('button').map((row) => row.textContent.replace(/^\d+|\d+$/g, ''))).toEqual(['Trends', 'My assets', 'My plan', 'Inbox', 'Ask AI']);
      fireEvent.click(ask);
      expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
      expect(ask).toHaveAttribute('aria-current', 'page');
    } finally { delete window.matchMedia; }
  });

  it('is gone when an admin turned Use Ask AI off for Channel owner: no entry, and ⌘J does nothing', async () => {
    openStudio('channel', { policy: roles.compilePolicy({ rev: 1, builtIn: { channel: { grant: [], deny: ['askAi'] } } }) });
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    expect(askButton()).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(screen.queryByRole('heading', { name: 'What can I help with?' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Trends for Semrush Blog' })).toBeInTheDocument();
  });

  it('is gone for one person whose own access turns it off, and back when it’s on', async () => {
    openStudio('channel', { access: { grants: [], denies: ['askAi'] } });
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    expect(askButton()).not.toBeInTheDocument();
    cleanup();
    openStudio('channel', { access: { grants: [], denies: [] } });
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    expect(askButton()).toBeInTheDocument();
  });

  it('keeps a picture in the conversation with Download, and no link to an Assets page the channel layout doesn’t have', async () => {
    const picture = { id: 'help-image-1', title: 'Blog hero', size: '1536x1024', prompt: 'A hero for the blog', family: 'none', dataUrl: 'data:image/png;base64,AA==' };
    const { api } = openStudio('channel', { api: {
      askHelp: vi.fn(async () => ({ answer: 'Here is a hero picture.', pages: [], followUps: [], actions: [], image: { title: 'Blog hero', prompt: 'A hero for the blog', size: '1536x1024', family: 'none' } })),
      createHelpImage: vi.fn(async () => picture),
    } });
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    fireEvent.click(askButton());
    const box = await screen.findByRole('textbox', { name: 'Question about Golden Thread' });
    fireEvent.change(box, { target: { value: 'Create a picture for my newest trend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('button', { name: 'Enlarge Blog hero' })).toBeInTheDocument();
    expect(api.createHelpImage).toHaveBeenCalledTimes(1);
    const figure = screen.getByRole('button', { name: 'Enlarge Blog hero' }).closest('.reply-card'); // the picture's card in the shared reply styling
    expect(within(figure).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(within(figure).queryByRole('button', { name: 'Assets' })).not.toBeInTheDocument();
    expect(figure).not.toHaveTextContent(/Saved to|\$/);
  });

  it('shows an admin previewing Blog’s owner the same entry and page, with the question box off', async () => {
    const { api } = openStudio('admin', { viewAs: { role: 'channel', channelId: 'blog' } });
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    fireEvent.click(askButton());
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send question' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', PREVIEW_TITLE);
    for (const starter of within(screen.getByRole('group', { name: 'Try asking' })).getAllByRole('button')) expect(starter).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Question about Golden Thread' }), { target: { value: 'Hi' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question about Golden Thread' }), { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(api.askHelp).not.toHaveBeenCalled();
  });
});

describe('the channel owner’s Ask AI buttons', () => {
  const stateFor = (who = 'channel', options = {}) => {
    const viewer = roles.buildViewer({ identity: identities[who], session: { viewAs: options.viewAs || null }, prefs: {}, editionId: 'semrush', web: true, admins, policy: options.policy || null });
    return roles.projectState(fixture.baseState(), viewer, { adoptions: fixture.adoptions(), admins, editionId: 'semrush' });
  };
  const allowed = (state) => (method) => state.viewer.allowed.includes(method);

  it('generates drafts for their channel only after they confirm what will be made, with no money', async () => {
    const state = stateFor();
    const api = { planAssetKit: vi.fn(async () => ({ title: 'Local packs shrink', folder: { id: 'blog', name: 'Semrush Blog', items: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text' }, { id: 'bloglong', label: 'Blog — Long-form Article', kind: 'text' }] }, minutes: 4, imagesReady: true })), createAssetKit: vi.fn(async () => ({ id: 'content-kit-new' })) };
    const confirm = vi.fn(async () => true); const action = vi.fn((fn) => fn());
    const runner = channelAskRunner({ api, state, viewer: state.viewer, canRun: allowed(state), action, confirm, imagesReady: true });
    const result = await runner.runAiAction({ kind: 'make-assets', label: 'Generate', target: 'Local packs shrink', themeId: 'theme-local' });
    expect(api.planAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-local-toolkit' }, deliverableIds: expect.arrayContaining(['blogshort', 'bloglong']) });
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Generate 2 drafts for “Local packs shrink”?', items: ['Short News Update', 'Long-form Article'], confirmLabel: 'Generate 2 drafts' });
    expect(JSON.stringify(confirm.mock.calls[0][0])).not.toMatch(/\$|cost|budget/i);
    expect(api.createAssetKit).toHaveBeenCalledWith({ source: { kind: 'report', assetId: 'asset-local-toolkit' }, deliverableIds: ['blogshort', 'bloglong'] });
    expect(result).toBe('Generating 2 drafts for Semrush Blog. Progress shows in My assets.');
    // Saying no makes nothing.
    confirm.mockResolvedValueOnce(false); api.createAssetKit.mockClear();
    expect(await runner.runAiAction({ kind: 'make-assets', target: 'Local packs shrink' })).toBe(false);
    expect(api.createAssetKit).not.toHaveBeenCalled();
  });

  it('saves their channel’s answer, opens their pages, and refuses a trend that isn’t theirs', async () => {
    const state = stateFor();
    const api = { setTrendAdoption: vi.fn(async () => ({})) }; const nav = { openTrend: vi.fn(), openFolder: vi.fn(), openTab: vi.fn() };
    const runner = channelAskRunner({ api, state, viewer: state.viewer, canRun: allowed(state), action: (fn) => fn(), confirm: async () => true, nav });
    expect(await runner.runAiAction({ kind: 'mark-used', target: 'Local packs shrink', themeId: 'theme-local', params: { channel: 'blog', status: 'using', date: '2026-10-24', link: 'https://www.semrush.com/blog/local' } })).toBe(`Saved: Semrush Blog is using “Local packs shrink”, planned for ${formatDay('2026-10-24')}.`);
    expect(api.setTrendAdoption).toHaveBeenCalledWith({ themeId: 'theme-local', status: 'using', link: 'https://www.semrush.com/blog/local', plannedFor: '2026-10-24' });
    expect(await runner.runAiAction({ kind: 'mark-used', target: 'Local packs shrink', params: { status: 'not-using' } })).toBe('Saved: “Local packs shrink” is not for Semrush Blog.');
    await expect(runner.runAiAction({ kind: 'mark-used', target: 'Agentic checkout', params: {} })).rejects.toThrow('I couldn’t find “Agentic checkout” among Semrush Blog’s trends.');
    expect(await runner.runAiAction({ kind: 'open', target: 'AI Overviews eat clicks', themeId: 'theme-aio', ref: { kind: 'trend', id: 'theme-aio' } })).toBe('Opened the brief.');
    expect(nav.openTrend).toHaveBeenCalledWith('theme-aio');
    await runner.runAiAction({ kind: 'open', target: 'AI Overviews eat clicks', ref: { kind: 'folder', id: 'theme-aio' }, params: { type: 'folder' } });
    expect(nav.openFolder).toHaveBeenCalledWith('theme-aio');
    await runner.runAiAction({ kind: 'open-tab', target: 'plan' });
    expect(nav.openTab).toHaveBeenCalledWith('plan');
    await expect(runner.runAiAction({ kind: 'open-tab', target: 'settings' })).rejects.toThrow('There’s no “settings” page here.');
    // A shared set is an editor's to finish, and a button outside the channel layout isn't theirs at all.
    await expect(runner.runAiAction({ kind: 'finish-assets', target: 'AI Overviews eat clicks', runId: 'content-kit-shared' })).rejects.toThrow('This set was made with other channels. Ask an editor.');
    await expect(runner.runAiAction({ kind: 'start-research', target: 'AI search pulse' })).rejects.toThrow('That isn’t something Ask AI can do in your channel.');
  });

  it('runs nothing while an admin previews, and nothing the role lacks', async () => {
    const preview = stateFor('admin', { viewAs: { role: 'channel', channelId: 'blog' } });
    const api = { setTrendAdoption: vi.fn(), planAssetKit: vi.fn(), createAssetKit: vi.fn() };
    const runner = channelAskRunner({ api, state: preview, viewer: preview.viewer, canRun: allowed(preview), action: (fn) => fn(), confirm: async () => true });
    await expect(runner.runAiAction({ kind: 'mark-used', target: 'Local packs shrink', params: { status: 'using' } })).rejects.toThrow(PREVIEW_TITLE);
    await expect(runner.runAiAction({ kind: 'make-assets', target: 'Local packs shrink' })).rejects.toThrow(PREVIEW_TITLE);
    expect(api.setTrendAdoption).not.toHaveBeenCalled(); expect(api.planAssetKit).not.toHaveBeenCalled();
    const reviewer = stateFor('channel', { policy: roles.compilePolicy({ rev: 1, builtIn: { channel: { grant: [], deny: ['makeAssets'] } } }) });
    const limited = channelAskRunner({ api, state: reviewer, viewer: reviewer.viewer, canRun: allowed(reviewer), action: (fn) => fn(), confirm: async () => true, askAdmin: 'Chris' });
    await expect(limited.runAiAction({ kind: 'make-assets', target: 'Local packs shrink' })).rejects.toThrow('Your access doesn’t include that. Ask Chris if you need it.');
  });

  it('opens only the pages the role has: no My plan for a role without Mark trends used', async () => {
    const state = stateFor('channel', { policy: roles.compilePolicy({ rev: 1, builtIn: { channel: { grant: [], deny: ['markTrendsUsed'] } } }) });
    expect(state.viewer.nav.main).not.toContain('plan');
    const nav = { openTab: vi.fn() };
    const runner = channelAskRunner({ api: {}, state, viewer: state.viewer, canRun: allowed(state), action: (fn) => fn(), confirm: async () => true, nav });
    await expect(runner.runAiAction({ kind: 'open-tab', target: 'plan' })).rejects.toThrow('There’s no “plan” page here.');
    await expect(runner.runAiAction({ kind: 'open', target: 'My plan', ref: { kind: 'page', id: 'plan' } })).rejects.toThrow('There’s no “My plan” page here.');
    expect(nav.openTab).not.toHaveBeenCalled();
    expect(await runner.runAiAction({ kind: 'open-tab', target: 'inbox' })).toBe('Opened.');
    expect(nav.openTab).toHaveBeenCalledWith('inbox');
  });

  it('offers a planned day only to a role with My plan, with the day written out', () => {
    const plannedFor = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const view = { channel: { name: 'Semrush Blog' }, trends: [{ themeId: 'theme-local', name: 'Local packs shrink', isNew: false, adoption: { status: 'using', plannedFor, link: '' } }], runs: [], assets: [] };
    const state = { contentStudio: { channelView: view } };
    const [row] = channelNeeds(state, () => true);
    expect(row).toMatchObject({ label: `“Local packs shrink” is planned for ${formatDay(plannedFor)}: add the live link when it’s out`, request: { kind: 'open-tab', target: 'plan' } });
    expect(row.label).not.toContain(plannedFor);
    expect(channelNeeds(state, (method) => method !== 'setTrendAdoption')).toEqual([]);
  });

  it('offers no starter about a newest trend when the channel has none', () => {
    const empty = { contentStudio: { channelView: { channel: { name: 'Semrush Blog' }, trends: [], runs: [], assets: [] } } };
    expect(channelStarters(empty, { imagesReady: true })).toEqual(['How do I mark a trend as used?']);
  });

  it('builds Needs you now and the starters from their channel’s view only', () => {
    const state = stateFor();
    expect(channelNeeds(state, allowed(state)).map((row) => [row.label, row.request.kind, row.request.target])).toEqual([['1 new trend for Semrush Blog: say if you’re using it', 'open-tab', 'trends']]);
    const starters = channelStarters(state, { can: allowed(state), imagesReady: false });
    expect(starters).toEqual(['What’s new for my channel this week?', 'Summarize the brief for “Local packs shrink”', 'Generate drafts for “Local packs shrink”', 'Which of my drafts are still drafts?']);
    expect(channelNeeds({ contentStudio: {} })).toEqual([]);
  });
});
