// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { SheetsView } from '../src/renderer/src/sheets-view.jsx';
import { AutomationView } from '../src/renderer/src/automation-view.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';
import roles from '../src/main/roles.js';
import fixture from './fixtures/roles-state.js';

// The renderer shell against the real policy: viewers come from roles.buildViewer and state from roles.projectState,
// exactly as the main process sends them, so these tests see what each role really receives.
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); });
const admins = [{ id: 'member-chris', name: 'Chris' }];
const identities = {
  admin: { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' },
  editor: { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link', memberSince: fixture.at('08-02') },
  channel: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', memberSince: fixture.at('10-01') },
  nobody: { id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, via: 'proxy' },
};
const GREETING = { level: 1, name: /Good (morning|afternoon|evening)/ };
const REPORT = 'AI Overviews eat clicks — Comprehensive Trends Report';
const labels = (nav) => within(nav).getAllByRole('button').map((button) => button.textContent.replace(/\d+$/, ''));

// A tiny studio server: who is signed in, their View as and layout, and the state the gate would project for them.
function openStudio(who, { viewAs = null, uiMode = 'simple', api: extra = {} } = {}) {
  const server = { who, viewAs, prefs: { uiMode, welcomedAt: '' }, base: fixture.baseState() };
  const project = () => {
    const viewer = roles.buildViewer({ identity: identities[server.who], session: { viewAs: server.viewAs }, prefs: server.prefs, editionId: 'semrush', web: false, admins });
    return roles.projectState(server.base, viewer, { adoptions: fixture.adoptions(), admins, memberCount: 5, editionId: 'semrush' });
  };
  const listeners = [];
  const api = {
    appMeta: vi.fn(async () => ({ version: '0.3.0' })), state: vi.fn(async () => project()), onStateChanged: vi.fn((fn) => { listeners.push(fn); return () => {}; }),
    readDataset: vi.fn(async () => ({ items: [] })), contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ markdown: `# Report ${assetId}\n\nOriginal text.` })),
    editStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId, edited: { at: '2026-10-16T09:00:00.000Z', by: { id: 'local', name: 'Chris' } } } })),
    restoreStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId } })),
    setViewAs: vi.fn(async (payload) => { server.viewAs = payload.role === 'admin' ? null : payload; return { viewer: project().viewer }; }),
    setViewPrefs: vi.fn(async (patch) => { server.prefs = { ...server.prefs, ...patch }; return { viewer: project().viewer }; }),
    saveSettings: vi.fn(async () => true), startResearchRun: vi.fn(async () => ({ id: 'research-next' })), decideResearchTheme: vi.fn(async () => true),
    getTeam: vi.fn(async () => ({ members: [], channels: [], signIn: { web: false } })), getTrendAnalytics: vi.fn(async () => null), selectContentWorkspace: vi.fn(async () => true),
    setTrendAdoption: vi.fn(async () => ({ adoption: null })), openSourceUrl: vi.fn(async () => true), askHelp: vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [] })),
    ...extra,
  };
  window.apifyStudio = api;
  const view = render(<App />);
  const push = () => act(() => { const next = project(); listeners.forEach((fn) => fn(next)); });
  return { api, view, server, project, push };
}

describe('One frame for every role', () => {
  it('gives an editor the five Simple tabs, but no Settings, admin pages, View as or ⌘,', async () => {
    openStudio('editor');
    await screen.findByRole('heading', GREETING);
    expect(labels(screen.getByRole('navigation', { name: 'Main' }))).toEqual(['Home', 'Reports', 'Trends', 'Assets', 'Ask AI']);
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'View as' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-spot="nav.role"]')).toHaveTextContent('Editor');
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', GREETING)).toBeInTheDocument();
    // Ask AI speaks to an editor without promising Settings.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Ask AI/ }));
    expect(screen.queryByRole('button', { name: /Show me where to turn on pictures/ })).not.toBeInTheDocument();
  });

  it('keeps Brand knowledge, Settings and program setup out of an editor’s Advanced layout', async () => {
    openStudio('editor', { uiMode: 'classic' });
    const primary = await screen.findByRole('navigation', { name: 'Primary' });
    expect(labels(primary)).toEqual(['Overview', 'Research programs', 'Sheets', 'Trend board', 'Create content', 'Library', 'More tools']);
    fireEvent.click(within(primary).getByRole('button', { name: 'More tools' }));
    expect(within(primary).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(within(primary).getByRole('button', { name: 'Research programs' }));
    expect((await screen.findAllByRole('heading', { name: 'AI search pulse' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause schedule|Resume schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New program' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start research/ })).toBeInTheDocument();
    // An old link to Settings says why instead of opening it.
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(screen.queryByRole('heading', { name: 'Connect your tools' })).not.toBeInTheDocument();
  });

  it('shows an admin the same program controls, and Analytics and People in the Admin nav', async () => {
    openStudio('admin', { uiMode: 'classic' });
    const primary = await screen.findByRole('navigation', { name: 'Primary' });
    expect(labels(primary)).toContain('Brand knowledge');
    fireEvent.click(within(primary).getByRole('button', { name: 'Research programs' }));
    expect(await screen.findByRole('button', { name: 'Edit program' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeInTheDocument();
    expect(labels(screen.getByRole('navigation', { name: 'Admin' }))).toEqual(['Analytics', 'People & roles']);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('gives a channel owner their own shell: Trends with a count, My assets, and nothing else', async () => {
    const { project } = openStudio('channel');
    const newTrends = project().contentStudio.channelView.counts.newTrends;
    expect(newTrends).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(labels(nav)).toEqual(['Trends', 'My assets']);
    expect(within(nav).getByRole('button', { name: `Trends, ${newTrends} new` }).querySelector('.simple-count')).toHaveTextContent(String(newTrends));
    expect(document.querySelector('.studio-frame')).toHaveAttribute('data-mode', 'channel');
    expect(screen.queryByRole('radiogroup', { name: 'Layout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your channel' })).toHaveTextContent('Semrush Blog');
    fireEvent.click(within(nav).getByRole('button', { name: /My assets/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My assets · Semrush Blog' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' })).toBeInTheDocument();
  });

  it('jumps to a trend in My assets only when opened from its card, not on later visits', async () => {
    openStudio('channel');
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.click(within(screen.getByRole('article', { name: 'AI Overviews eat clicks' })).getByRole('button', { name: /Open my assets/ }));
    const group = await screen.findByRole('heading', { level: 2, name: 'AI Overviews eat clicks' });
    await waitFor(() => expect(group).toHaveFocus());
    fireEvent.click(nav().getByRole('button', { name: /Trends/ }));
    await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' });
    fireEvent.click(nav().getByRole('button', { name: /My assets/ }));
    await screen.findByRole('heading', { level: 1, name: 'My assets · Semrush Blog' });
    expect(screen.getByRole('heading', { level: 2, name: 'AI Overviews eat clicks' })).not.toHaveFocus();
  });

  it('shows someone without a role who to ask, and lets them in once they’re added', async () => {
    const { api, server } = openStudio('nobody', { api: { signOut: vi.fn() } });
    expect(await screen.findByRole('heading', { name: 'You’re not in this studio yet' })).toBeInTheDocument();
    expect(screen.getByText('pat@semrush.com')).toBeInTheDocument();
    expect(screen.getByText(/Ask Chris to add you/)).toBeInTheDocument();
    expect(document.querySelector('.studio-sidebar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(api.signOut).toHaveBeenCalled();
    server.who = 'editor';
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('previews another role with a banner, and Back to Admin ends it', async () => {
    const { api } = openStudio('admin', { viewAs: { role: 'editor' } });
    await screen.findByRole('heading', GREETING);
    expect(screen.getByText('Previewing what an editor sees. Buttons that change things are off.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'View as' })).toHaveValue('editor');
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Admin' }));
    await waitFor(() => expect(api.setViewAs).toHaveBeenCalledWith({ role: 'admin' }));
    await waitFor(() => expect(screen.queryByText(/Previewing what/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText(/Your role changed/)).not.toBeInTheDocument();
  });

  it('says so when someone else changes this person’s role', async () => {
    const { server, push } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    server.who = 'editor';
    push();
    expect(await screen.findByText('Your role changed to Editor.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});

describe('View as an editor shows what an editor sees', () => {
  const PREVIEW = 'Buttons that change things are off in a preview.';
  const main = () => within(screen.getByRole('navigation', { name: 'Main' }));
  const states = (name) => screen.queryAllByRole('button', { name }).map((button) => (button.disabled ? `off: ${button.title}` : 'on'));
  async function walk() {
    await screen.findByRole('heading', GREETING);
    const seen = { send: screen.getByRole('button', { name: 'Ask' }).title };
    fireEvent.click(main().getByRole('button', { name: /Trends/ }));
    await screen.findByRole('heading', { level: 1, name: 'Trends' });
    seen.subhead = screen.getByRole('heading', { level: 1, name: 'Trends' }).parentElement.querySelector('p').textContent;
    for (const name of [/Yes, use it/, /^Skip$/, /Find new trends/]) seen[String(name)] = states(name);
    fireEvent.click(main().getByRole('button', { name: /Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Local packs shrink — Comprehensive Trends Report/ }));
    await screen.findByText(/Original text/);
    for (const name of ['Edit', 'Make channel assets', 'Ask AI about this']) seen[name] = states(name);
    return seen;
  }

  it('shows an editor’s buttons, turned off with the reason, where the real editor has them on', async () => {
    openStudio('editor');
    const real = await walk();
    cleanup(); delete window.apifyStudio;
    const { api } = openStudio('admin', { viewAs: { role: 'editor' } });
    const preview = await walk();
    expect(real).toMatchObject({ send: '', subhead: 'Research finds them. You decide which ones become reports.', Edit: ['on'], 'Make channel assets': ['on'], 'Ask AI about this': ['on'] });
    expect(preview.subhead).toBe(real.subhead);
    for (const [key, value] of Object.entries(real)) {
      if (!Array.isArray(value)) continue;
      expect(value.length, key).toBeGreaterThan(0);
      expect(preview[key], key).toEqual(value.map(() => `off: ${PREVIEW}`));
    }
    expect(preview.send).toBe(PREVIEW);
    // Settings, Analytics and People stay out of an editor preview: an editor doesn't have them.
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    // Ask AI is there, as for an editor, but sends nothing.
    fireEvent.click(main().getByRole('button', { name: /Ask AI/ }));
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    expect(api.askHelp).not.toHaveBeenCalled();
  });
});

describe('The layout switch', () => {
  it('keeps focus on the radio just pressed, because the frame never remounts', async () => {
    const { api } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    const frame = document.querySelector('.studio-frame'); const sidebar = document.querySelector('.studio-sidebar');
    const advanced = within(screen.getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', { name: 'Advanced' });
    advanced.focus();
    fireEvent.click(advanced);
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    await waitFor(() => expect(api.setViewPrefs).toHaveBeenCalledWith({ uiMode: 'classic' }));
    expect(document.activeElement).toBe(advanced);
    expect(advanced).toBeChecked();
    expect(document.querySelector('.studio-frame')).toBe(frame);
    expect(document.querySelector('.studio-sidebar')).toBe(sidebar);
    expect(frame).toHaveAttribute('data-mode', 'classic');
  });

  it('peeks at an Advanced page from Simple without saving a layout, and Simple returns to the same tab', async () => {
    const { api } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Trends/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Full board' }));
    const primary = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(primary).getByRole('button', { name: 'Trend board' })).toHaveAttribute('aria-current', 'page');
    const layout = within(screen.getByRole('radiogroup', { name: 'Layout' }));
    expect(layout.getByRole('radio', { name: 'Advanced' })).toBeChecked();
    expect(screen.queryByRole('button', { name: /Back to Simple/ })).not.toBeInTheDocument();
    fireEvent.click(layout.getByRole('radio', { name: 'Simple' }));
    const main = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('button', { name: /Trends/ })).toHaveAttribute('aria-current', 'page');
    expect(api.setViewPrefs).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });
});

describe('Simple reader', () => {
  it('shows who used a report, edits it in place, and asks before leaving unsaved edits', async () => {
    const { api } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    const main = () => within(screen.getByRole('navigation', { name: 'Main' }));
    fireEvent.click(main().getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${REPORT}`) }))[0]); // the newest of two runs
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    expect(screen.getByText('Used by Semrush Blog')).toBeInTheDocument();
    const uses = screen.getByRole('region', { name: 'Where it’s used' });
    fireEvent.click(within(uses).getByRole('link', { name: /semrush\.com\/blog\/ai-overviews/ }));
    expect(api.openSourceUrl).toHaveBeenCalledWith('https://www.semrush.com/blog/ai-overviews/');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const text = await screen.findByRole('textbox', { name: `Text of ${REPORT}` });
    fireEvent.change(text, { target: { value: '# Report\n\nSharper text.' } });
    // Leaving with unsaved edits asks first; saying no keeps the editor and the text.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(main().getByRole('button', { name: /Home/ }));
    expect(confirm).toHaveBeenCalledWith('Leave without saving your edits?');
    expect(screen.getByRole('textbox', { name: `Text of ${REPORT}` })).toHaveValue('# Report\n\nSharper text.');
    confirm.mockRestore();

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.editStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-aio-report-2', markdown: '# Report\n\nSharper text.', baseEditedAt: '' }));
    expect(await screen.findByText('Sharper text.')).toBeInTheDocument();
    expect(screen.getByText(/Edited by Chris/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: `Text of ${REPORT}` })).not.toBeInTheDocument();
  });

  it('never saves over someone else’s edit that arrived while the report was open', async () => {
    const pushed = { at: '2026-10-16T08:30:00.000Z', by: { id: 'member-riley', name: 'Riley' } };
    const reads = [];
    const readStudioAsset = vi.fn(async ({ assetId }) => { reads.push(assetId); const edited = reads.length > 1 ? { at: pushed.at, byName: 'Riley' } : null; return { asset: { id: assetId, ...(edited ? { edited: pushed } : {}) }, markdown: edited ? `# Report ${assetId}\n\nRiley’s text.` : `# Report ${assetId}\n\nOriginal text.`, edited }; });
    const editStudioAsset = vi.fn(async () => { throw Object.assign(new Error('Riley saved this report at 8:30 AM, after you opened it. Copy your text, reopen the report and try again.'), { status: 409 }); });
    const { server, push } = openStudio('admin', { api: { readStudioAsset, editStudioAsset } });
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Local packs shrink — Comprehensive Trends Report/ }));
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    const id = reads[0];
    // Riley's save reaches this screen as a state push. Opening the editor before the text is read again still starts
    // from what was on screen, so the save is checked against the version that text came from.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    server.base.contentStudio.assets = server.base.contentStudio.assets.map((asset) => (asset.id === id ? { ...asset, edited: pushed } : asset));
    push();
    const text = await screen.findByRole('textbox', { name: /^Text of / });
    fireEvent.change(text, { target: { value: '# Report\n\nOriginal text.\n\nChris adds a line.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(editStudioAsset).toHaveBeenCalledWith({ assetId: id, markdown: '# Report\n\nOriginal text.\n\nChris adds a line.', baseEditedAt: '' }));
    expect(await screen.findByText(/after you opened it/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Text of / })).toHaveValue('# Report\n\nOriginal text.\n\nChris adds a line.');
    // Cancelling reads the saved version, so the next edit starts from Riley's text and her time.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Riley’s text.')).toBeInTheDocument();
    expect(screen.getByText(/Edited by Riley/)).toBeInTheDocument();
    editStudioAsset.mockImplementation(async ({ assetId }) => ({ asset: { id: assetId, edited: { at: '2026-10-16T09:00:00.000Z', by: { id: 'local', name: 'Chris' } } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Text of / }), { target: { value: 'Both of us.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(editStudioAsset).toHaveBeenLastCalledWith({ assetId: id, markdown: 'Both of us.', baseEditedAt: pushed.at }));
  });

  it('reads a report again when someone else saves it while it is open', async () => {
    let version = 0;
    const readStudioAsset = vi.fn(async ({ assetId }) => (version ? { asset: { id: assetId }, markdown: '# R\n\nRiley’s text.', edited: { at: '2026-10-16T08:30:00.000Z', byName: 'Riley' } } : { asset: { id: assetId }, markdown: '# R\n\nOriginal text.', edited: null }));
    const { server, push } = openStudio('editor', { api: { readStudioAsset } });
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Local packs shrink — Comprehensive Trends Report/ }));
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    const id = readStudioAsset.mock.calls[0][0].assetId;
    version = 1;
    server.base.contentStudio.assets = server.base.contentStudio.assets.map((asset) => (asset.id === id ? { ...asset, edited: { at: '2026-10-16T08:30:00.000Z', by: { id: 'member-riley', name: 'Riley' } } } : asset));
    push();
    expect(await screen.findByText('Riley’s text.')).toBeInTheDocument();
    expect(readStudioAsset).toHaveBeenCalledTimes(2);
  });

  it('keeps unsaved edits on screen when an admin switches everyone’s workspace', async () => {
    const { server, push } = openStudio('editor');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Local packs shrink — Comprehensive Trends Report/ }));
    await screen.findByText('Original text.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Text of / }), { target: { value: 'Half-written edit…' } });
    server.base.contentStudio.activeWorkspaceId = 'general';
    push();
    expect(screen.getByRole('textbox', { name: /^Text of / })).toHaveValue('Half-written edit…');
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t in the studio’s workspace anymore/);
    expect(screen.getByRole('button', { name: 'Copy my text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled();
    // Leaving still asks first; once closed, the reader goes back to the (new) workspace's list.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledWith('Leave without saving your edits?');
    expect(screen.queryByRole('textbox', { name: /^Text of / })).not.toBeInTheDocument();
  });

  it('names the channels that used a report for an editor too, who gets no channel list', async () => {
    openStudio('editor');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(`^${REPORT}`) }))[0]);
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    expect(screen.getByText('Used by Semrush Blog')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Where it’s used' })).getByText(/Semrush Blog/)).toBeInTheDocument();
  });

  it('asks before a second search while one with the same program is still going', async () => {
    const { api } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Trends/ }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: /Find new trends/ }));
    expect(confirm.mock.calls[0][0]).toMatch(/started a search with this program at .+\. It’s still running\. Start another\?/);
    await waitFor(() => expect(api.startResearchRun).toHaveBeenCalledWith({ programId: 'program-pulse', datasetIds: [], again: true }));
  });

  it('still asks when the newest search finished but an older one waits for review, as the server refuses that too', async () => {
    const { api, server, push } = openStudio('admin');
    await screen.findByRole('heading', GREETING);
    server.base.contentStudio.researchRuns = server.base.contentStudio.researchRuns.map((run) => (run.id === 'research-running' ? { ...run, status: 'succeeded' } : run));
    push();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Trends/ }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: /Find new trends/ }));
    expect(confirm.mock.calls[0][0]).toMatch(/started a search with this program at .+\. Its trends are waiting for review\. Start another\?/);
    await waitFor(() => expect(api.startResearchRun).toHaveBeenCalledWith({ programId: 'program-pulse', datasetIds: [], again: true }));
  });
});

describe('Buttons follow the role', () => {
  const preview = roles.buildViewer({ identity: identities.admin, session: { viewAs: { role: 'editor' } }, prefs: {}, editionId: 'semrush', admins });
  const editor = roles.buildViewer({ identity: identities.editor, prefs: {}, editionId: 'semrush', admins });
  const admin = roles.buildViewer({ identity: identities.admin, prefs: {}, editionId: 'semrush', admins });
  const recipes = { state: { recipes: [{ id: 'recipe-1', name: 'X search', platform: 'x', actorId: 'apify/x' }], runs: [], datasets: [] }, busy: false, onSaveRecipe: vi.fn(), onRunRecipe: vi.fn() };

  it('offers Delete on a scraper only to admins', () => {
    const { unmount } = render(<ViewerContext.Provider value={admin}><AutomationView {...recipes} onDeleteRecipe={vi.fn()} /></ViewerContext.Provider>);
    expect(screen.getByRole('button', { name: 'Delete X search' })).toBeInTheDocument();
    unmount();
    // App passes no onDeleteRecipe when can('deleteRecipe') is false, as for an editor.
    render(<ViewerContext.Provider value={editor}><AutomationView {...recipes} /></ViewerContext.Provider>);
    expect(screen.queryByRole('button', { name: 'Delete X search' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run X search' })).toBeInTheDocument();
  });

  it('hides Remove from Sheets when the person can’t remove workbooks, and shows it turned off in an editor preview', async () => {
    const workbook = { id: 'import-1', kind: 'import', name: 'Q3 keywords', source: { kind: 'file', fileName: 'q3.xlsx' }, edits: { version: 1, sheets: {} }, sheets: [{ id: 's1', name: 'Sheet1', columns: ['Keyword'], rows: [['ai search']], rowKeys: ['r1'] }] };
    const bridge = { listWorkbooks: vi.fn(async () => [{ id: 'import-1', kind: 'import', name: 'Q3 keywords', sheetCount: 1, rowCount: 1, source: workbook.source }]), readWorkbook: vi.fn(async () => JSON.parse(JSON.stringify(workbook))), saveWorkbookEdits: vi.fn(async () => ({})), removeWorkbook: vi.fn(), renameWorkbook: vi.fn(), importWorkbook: vi.fn() };
    const openMenu = async (viewer) => {
      const view = render(<ViewerContext.Provider value={viewer}><SheetsView api={bridge} state={{}} onNavigate={vi.fn()} initialWorkbookId="import-1" /></ViewerContext.Provider>);
      await screen.findByRole('grid');
      fireEvent.click(screen.getByRole('button', { name: /Q3 keywords/ }));
      return view;
    };
    const first = await openMenu(admin);
    expect(await screen.findByRole('menuitem', { name: /Remove from Sheets/ })).toBeInTheDocument();
    first.unmount();
    const second = await openMenu(preview);
    // An admin previewing an editor sees what the editor sees, with buttons that change things turned off.
    expect(await screen.findByRole('menuitem', { name: /Remove from Sheets/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /Rename this workbook/ })).toHaveAttribute('title', 'Buttons that change things are off in a preview.');
    second.unmount();
    // Someone whose role can't change workbooks doesn't see those items at all.
    await openMenu({ ...editor, allowed: editor.allowed.filter((method) => !['renameWorkbook', 'removeWorkbook', 'importWorkbook', 'pullGoogleSheet'].includes(method)) });
    expect(await screen.findByRole('menu', { name: 'Workbooks' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Remove from Sheets/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Rename this workbook/ })).not.toBeInTheDocument();
  });
});
