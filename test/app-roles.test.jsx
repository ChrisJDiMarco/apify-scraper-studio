// @vitest-environment jsdom
import './helpers/prosemirror-dom.js';
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
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });
const admins = [{ id: 'member-chris', name: 'Chris' }];
const identities = {
  admin: { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' },
  editor: { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, via: 'link', memberSince: fixture.at('08-02') },
  channel: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', memberSince: fixture.at('10-01') },
  nobody: { id: 'guest:pat@semrush.com', name: 'pat', email: 'pat@semrush.com', role: null, via: 'proxy' },
};
// Home is the weekly briefing in both layouts (weekly-briefing.jsx).
const GREETING = { level: 1, name: /^This week in/ };
const REPORT = 'AI Overviews eat clicks — Comprehensive Trends Report';
// Simple's Reports lists one row per trend, named after the trend; the row opens its Trends report.
const ROW = (trend) => new RegExp(`^${trend}`);
const labels = (nav) => within(nav).getAllByRole('button').map((button) => button.textContent.replace(/\d+$/, ''));
const mainNav = () => screen.getByRole('navigation', { name: 'Main' });

// A tiny studio server: who is signed in, their View as and layout, and the state the gate would project for them.
function openStudio(who, { viewAs = null, uiMode = 'simple', access = null, api: extra = {} } = {}) {
  const server = { who, viewAs, prefs: { uiMode, welcomedAt: '' }, base: fixture.baseState() };
  const project = () => {
    const viewer = roles.buildViewer({ identity: identities[server.who], session: { viewAs: server.viewAs }, prefs: server.prefs, editionId: 'semrush', web: false, admins, access });
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
  it('gives an editor the Simple pages and Ask AI, but no Settings, Studio pages, View as or ⌘,', async () => {
    openStudio('editor');
    await screen.findByRole('heading', GREETING);
    expect(labels(mainNav())).toEqual(['Home', 'Trends', 'Reports', 'Assets', 'Inbox', 'Calendar']);
    expect(within(mainNav()).queryByRole('group', { name: 'Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Account:/ }));
    expect(screen.queryByRole('group', { name: 'View as' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Account' }), { key: 'Escape' });
    expect(document.querySelector('[data-spot="nav.workspace"]')).toHaveTextContent('Editor');
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', GREETING)).toBeInTheDocument();
    // Ask AI speaks to an editor without promising Settings.
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(screen.queryByRole('button', { name: /Show me where to turn on pictures/ })).not.toBeInTheDocument();
  });

  it('keeps Brand knowledge, Settings and program setup out of an editor’s Advanced layout', async () => {
    openStudio('editor', { uiMode: 'classic' });
    const primary = await screen.findByRole('navigation', { name: 'Main' });
    await within(primary).findByRole('group', { name: 'Research' });
    expect(labels(primary)).toEqual(['Home', 'Inbox', 'Research programs', 'Trend board', 'Sheets', 'Create content', 'Library', 'Calendar', 'Data tools']);
    fireEvent.click(within(primary).getByRole('button', { name: 'Data tools' }));
    expect(within(primary).queryByRole('button', { name: /^Settings/ })).not.toBeInTheDocument();
    fireEvent.click(within(primary).getByRole('button', { name: /^Research programs/ }));
    expect((await screen.findAllByRole('heading', { name: 'AI search pulse' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause schedule|Resume schedule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New program' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start research/ })).toBeInTheDocument();
    // An old link to Settings says why instead of opening it.
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(screen.queryByRole('heading', { name: 'Connect your tools' })).not.toBeInTheDocument();
  });

  it('lists the whole Brand knowledge page in Simple’s Studio group, where the palette and old #/settings/knowledge links land', async () => {
    try {
      openStudio('admin');
      await screen.findByRole('heading', GREETING);
      const studio = within(mainNav()).getByRole('group', { name: 'Studio' });
      expect(labels(studio)).toEqual(['Analytics', 'People & access', 'Brand knowledge', 'Settings']); // this studio's api has no Prompts
      fireEvent.click(within(studio).getByRole('button', { name: /^Brand knowledge/ }));
      expect(await screen.findByRole('tab', { name: 'Research brand profiles' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Brand knowledge' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Save brand knowledge/ })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Content studio' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Back to Simple/ })).not.toBeInTheDocument(); // a Simple page, not a peek
      expect(within(studio).getByRole('button', { name: /^Brand knowledge/ })).toHaveAttribute('aria-current', 'page');
      // Settings no longer holds it.
      fireEvent.click(within(studio).getByRole('button', { name: /^Settings/ }));
      const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
      expect(within(sections).queryByRole('link', { name: /^Brand knowledge/ })).not.toBeInTheDocument();
      // ⌘K's Brand knowledge opens the same page.
      fireEvent.click(within(mainNav()).getByRole('button', { name: /^Home/ }));
      await screen.findByRole('heading', GREETING);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
      const palette = await screen.findByRole('dialog', { name: 'Command palette' });
      fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: 'Brand knowledge' } });
      fireEvent.click((await within(palette).findAllByRole('button', { name: /Brand knowledge/ }))[0]);
      expect(await screen.findByRole('tab', { name: 'Research brand profiles' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Back to Simple/ })).not.toBeInTheDocument();
      // An old link to the Settings section lands on the page too.
      fireEvent.click(within(mainNav()).getByRole('button', { name: /^Home/ }));
      await screen.findByRole('heading', GREETING);
      act(() => { window.location.hash = '#/settings/knowledge'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      expect(await screen.findByRole('tab', { name: 'Research brand profiles' })).toBeInTheDocument();
    } finally { window.history.replaceState(null, '', '/'); }
  });

  it('keeps Brand knowledge under Content in Advanced, with no Brand knowledge in Advanced’s Settings', async () => {
    openStudio('admin', { uiMode: 'classic' });
    const primary = await screen.findByRole('navigation', { name: 'Main' });
    await within(primary).findByRole('group', { name: 'Content' });
    expect(labels(within(primary).getByRole('group', { name: 'Content' }))).toContain('Brand knowledge');
    fireEvent.click(within(primary).getByRole('button', { name: /^Settings/ }));
    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByRole('link', { name: /^Brand knowledge/ })).not.toBeInTheDocument();
  });

  it('gives an editor who may edit brand knowledge Brand knowledge in Simple’s Studio group, and no Settings', async () => {
    openStudio('editor', { access: { grants: ['editBrand'] } });
    await screen.findByRole('heading', GREETING);
    expect(within(mainNav()).queryByRole('button', { name: /^Settings/ })).not.toBeInTheDocument();
    fireEvent.click(within(mainNav()).getByRole('button', { name: /^Brand knowledge/ }));
    expect(await screen.findByRole('tab', { name: 'Research brand profiles' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Brand knowledge' })).toBeInTheDocument();
  });

  it('keeps Advanced as it was for that editor: Brand knowledge under Content, and no Settings', async () => {
    openStudio('editor', { uiMode: 'classic', access: { grants: ['editBrand'] } });
    const primary = await screen.findByRole('navigation', { name: 'Main' });
    await within(primary).findByRole('group', { name: 'Content' });
    expect(labels(within(primary).getByRole('group', { name: 'Content' }))).toContain('Brand knowledge');
    expect(within(primary).queryByRole('button', { name: /^Settings/ })).not.toBeInTheDocument();
  });

  it('shows an admin the same program controls, and Analytics, People and Settings in the Studio group', async () => {
    openStudio('admin', { uiMode: 'classic' });
    const primary = await screen.findByRole('navigation', { name: 'Main' });
    await within(primary).findByRole('group', { name: 'Research' });
    expect(labels(primary)).toContain('Brand knowledge');
    fireEvent.click(within(primary).getByRole('button', { name: /^Research programs/ }));
    expect(await screen.findByRole('button', { name: 'Edit program' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeInTheDocument();
    expect(labels(within(primary).getByRole('group', { name: 'Studio' }))).toEqual(['Analytics', 'People & access', 'Settings']);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('gives a channel owner their own shell: Trends with a count, My assets, My plan and Inbox, and nothing else', async () => {
    const { project } = openStudio('channel');
    const newTrends = project().contentStudio.channelView.counts.newTrends;
    expect(newTrends).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trends for Semrush Blog' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(labels(nav)).toEqual(['Trends', 'My assets', 'My plan', 'Inbox']);
    expect(within(nav).getByRole('button', { name: `Trends, ${newTrends} new` }).querySelector('.sb-badge')).toHaveTextContent(String(newTrends));
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
    fireEvent.click(screen.getByRole('button', { name: /^Account: Chris, Viewing as Editor/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Editor' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Account' }), { key: 'Escape' });
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
    for (const name of [/Yes, use it/, /^Skip /, /Find new trends/]) seen[String(name)] = states(name); // Skip is named after its trend
    fireEvent.click(main().getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('Local packs shrink') }))[0]);
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
    expect(main().queryByRole('group', { name: 'Studio' })).not.toBeInTheDocument();
    // Ask AI is there, as for an editor, but sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
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
    expect(await within(mainNav()).findByRole('group', { name: 'Research' })).toBeInTheDocument();
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
    await screen.findByRole('heading', { level: 1, name: 'Trends' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: 'Trend board' } });
    fireEvent.click(within(palette).getByRole('button', { name: /Open Trend board/ }));
    const primary = mainNav();
    expect(await within(primary).findByRole('button', { name: /^Trend board/ })).toHaveAttribute('aria-current', 'page');
    const layout = within(screen.getByRole('radiogroup', { name: 'Layout' }));
    expect(layout.getByRole('radio', { name: 'Advanced' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Advanced page' })).toHaveTextContent('Your layout is still Simple.');
    fireEvent.click(layout.getByRole('radio', { name: 'Simple' }));
    const main = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('button', { name: /Trends/ })).toHaveAttribute('aria-current', 'page');
    expect(api.setViewPrefs).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });
});

describe('Simple reader', () => {
  // The editor (report-editor/ReportDocument.jsx) saves as people type; typing goes through the editor's commands here.
  const typeInto = async (pattern, text) => { const box = await screen.findByRole('textbox', { name: pattern }); await waitFor(() => expect(box.editor).toBeTruthy()); act(() => { box.editor.chain().focus('end').insertContent(text).run(); }); return box; };
  const saveNow = () => fireEvent.keyDown(window, { key: 's', metaKey: true });

  it('shows who used a report, edits it in place, and asks before leaving edits that didn’t save', async () => {
    const { api } = openStudio('admin');
    api.editStudioAsset.mockRejectedValueOnce(new Error('The studio is offline.'));
    await screen.findByRole('heading', GREETING);
    const main = () => within(screen.getByRole('navigation', { name: 'Main' }));
    fireEvent.click(main().getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('AI Overviews eat clicks') }))[0]); // the newest of two runs
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    expect(screen.getByText('Used by Semrush Blog')).toBeInTheDocument();
    const uses = screen.getByRole('region', { name: 'Where it’s used' });
    fireEvent.click(within(uses).getByRole('link', { name: /semrush\.com\/blog\/ai-overviews/ }));
    expect(api.openSourceUrl).toHaveBeenCalledWith('https://www.semrush.com/blog/ai-overviews/');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const text = await typeInto(`Text of ${REPORT}`, ' Sharper text.');
    saveNow();
    await screen.findByText('Not saved');
    // Leaving with edits that didn't save asks first; saying no keeps the editor and the text.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(main().getByRole('button', { name: /Home/ }));
    expect(confirm).toHaveBeenCalledWith('Leave without saving your edits?');
    expect(text).toHaveTextContent('Sharper text.');
    confirm.mockRestore();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.editStudioAsset).toHaveBeenLastCalledWith({ assetId: 'asset-aio-report-2', markdown: '# Report asset-aio-report-2\n\nOriginal text. Sharper text.', baseEditedAt: '' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: `Text of ${REPORT}` })).not.toBeInTheDocument());
    expect(await screen.findByText('Original text. Sharper text.')).toBeInTheDocument();
    expect(screen.getByText(/Edited by Chris/)).toBeInTheDocument();
  });

  it('never saves over someone else’s edit that arrived while the report was open', async () => {
    const pushed = { at: '2026-10-16T08:30:00.000Z', by: { id: 'member-riley', name: 'Riley' } };
    const reads = [];
    const readStudioAsset = vi.fn(async ({ assetId }) => { reads.push(assetId); const edited = reads.length > 1 ? { at: pushed.at, byName: 'Riley' } : null; return { asset: { id: assetId, ...(edited ? { edited: pushed } : {}) }, markdown: edited ? `# Report ${assetId}\n\nRiley’s text.` : `# Report ${assetId}\n\nOriginal text.`, edited }; });
    const editStudioAsset = vi.fn(async () => { throw Object.assign(new Error('Riley saved this report at 8:30 AM, after you opened it. Copy your text, reopen the report and try again.'), { status: 409 }); });
    const { server, push } = openStudio('admin', { api: { readStudioAsset, editStudioAsset } });
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('Local packs shrink') }))[0]);
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    const id = reads[0];
    // Riley's save reaches this screen as a state push. Opening the editor before the text is read again still starts
    // from what was on screen, so the save is checked against the version that text came from.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    server.base.contentStudio.assets = server.base.contentStudio.assets.map((asset) => (asset.id === id ? { ...asset, edited: pushed } : asset));
    push();
    const text = await typeInto(/^Text of /, ' Chris adds a line.');
    saveNow();
    await waitFor(() => expect(editStudioAsset).toHaveBeenCalledWith({ assetId: id, markdown: `# Report ${id}\n\nOriginal text. Chris adds a line.`, baseEditedAt: '' }));
    expect(await screen.findByText(/after you opened it/)).toBeInTheDocument();
    expect(text).toHaveTextContent('Chris adds a line.');
    // Leaving reads the saved version, so the next edit starts from Riley's text and her time.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Riley’s text.')).toBeInTheDocument();
    expect(screen.getByText(/Edited by Riley/)).toBeInTheDocument();
    editStudioAsset.mockImplementation(async ({ assetId }) => ({ asset: { id: assetId, edited: { at: '2026-10-16T09:00:00.000Z', by: { id: 'local', name: 'Chris' } } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await typeInto(/^Text of /, ' Both of us.');
    saveNow();
    await waitFor(() => expect(editStudioAsset).toHaveBeenLastCalledWith({ assetId: id, markdown: `# Report ${id}\n\nRiley’s text. Both of us.`, baseEditedAt: pushed.at }));
  });

  it('reads a report again when someone else saves it while it is open', async () => {
    let version = 0;
    const readStudioAsset = vi.fn(async ({ assetId }) => (version ? { asset: { id: assetId }, markdown: '# R\n\nRiley’s text.', edited: { at: '2026-10-16T08:30:00.000Z', byName: 'Riley' } } : { asset: { id: assetId }, markdown: '# R\n\nOriginal text.', edited: null }));
    const { server, push } = openStudio('editor', { api: { readStudioAsset } });
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('Local packs shrink') }))[0]);
    expect(await screen.findByText('Original text.')).toBeInTheDocument();
    const id = readStudioAsset.mock.calls[0][0].assetId;
    version = 1;
    server.base.contentStudio.assets = server.base.contentStudio.assets.map((asset) => (asset.id === id ? { ...asset, edited: { at: '2026-10-16T08:30:00.000Z', by: { id: 'member-riley', name: 'Riley' } } } : asset));
    push();
    expect(await screen.findByText('Riley’s text.')).toBeInTheDocument();
    expect(readStudioAsset).toHaveBeenCalledTimes(2);
  });

  it('keeps unsaved edits on screen when an admin switches everyone’s workspace', async () => {
    const { api, server, push } = openStudio('editor');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('Local packs shrink') }))[0]);
    await screen.findByText('Original text.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await typeInto(/^Text of /, ' Half-written edit…');
    server.base.contentStudio.activeWorkspaceId = 'general';
    push();
    // The text stays (read-only now), with Copy my text, and nothing is sent to a report that isn't here anymore.
    const page = await screen.findByRole('document', { name: /Comprehensive Trends Report/ });
    expect(page).toHaveTextContent('Half-written edit…');
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t in the studio’s workspace anymore/);
    expect(screen.getByRole('button', { name: 'Copy my text' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(api.editStudioAsset).not.toHaveBeenCalled();
    // Leaving still asks first; once closed, the reader goes back to the (new) workspace's list.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Leave without saving your edits?')));
    await waitFor(() => expect(screen.queryByRole('document', { name: /Comprehensive Trends Report/ })).not.toBeInTheDocument());
  });

  it('names the channels that used a report for an editor too, who gets no channel list', async () => {
    openStudio('editor');
    await screen.findByRole('heading', GREETING);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Reports/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: ROW('AI Overviews eat clicks') }))[0]);
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
    await waitFor(() => expect(confirm).toHaveBeenCalled());
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
    await waitFor(() => expect(confirm).toHaveBeenCalled());
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

describe('A custom role from People & access', () => {
  // The same shell for a role an admin made: a Viewer reads reports, trends and evidence, and nothing else.
  it('gives a Viewer no Ask AI, Sheets, Create content or Data tools, and no money in its state', async () => {
    const policy = roles.compilePolicy({ roles: [{ id: 'role-viewer-ab12', label: 'Viewer', base: 'editor', capabilities: ['core', 'readAssets', 'readResearch'] }] });
    const build = roles.buildViewer;
    vi.spyOn(roles, 'buildViewer').mockImplementation((options) => build({ ...options, identity: { ...options.identity, roleId: 'role-viewer-ab12' }, policy }));
    const { project } = openStudio('editor', { uiMode: 'classic' });
    expect(project().viewer).toMatchObject({ role: 'editor', roleId: 'role-viewer-ab12', roleLabel: 'Viewer', capabilities: ['core', 'readAssets', 'readResearch'] });
    expect(project().viewer.hiddenPages).toEqual(expect.arrayContaining(['ask', 'sheets', 'create', 'data-tools', 'prompts']));
    expect(JSON.stringify(project())).not.toMatch(/"costUsd"|"maxBudgetUsd"|"receipts"/);
    const primary = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(primary).queryByRole('button', { name: /^Data tools/ })).not.toBeInTheDocument();
    expect(within(primary).queryByRole('button', { name: /^Sheets/ })).not.toBeInTheDocument();
    expect(within(primary).queryByRole('button', { name: /^Create content/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask AI' })).not.toBeInTheDocument();
    expect(within(primary).getByRole('button', { name: /^Library/ })).toBeInTheDocument();
  });
});

