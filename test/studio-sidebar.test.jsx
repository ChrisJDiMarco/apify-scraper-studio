// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChannelBottomNav, StudioSidebar, StudioTopBar } from '../src/renderer/src/studio-sidebar.jsx';
import { buildNav } from '../src/renderer/src/nav-model.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.matchMedia; });
const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }, { id: 'general', name: 'General', editionId: 'general' }];
const channels = [{ id: 'blog', name: 'Semrush Blog', short: 'Blog' }, { id: 'social', name: 'Semrush Social Team', short: 'Social' }];
const admin = (over = {}) => ({ id: 'local', name: 'Alex Rivera', email: '', role: 'admin', realRole: 'admin', channelId: null, channelName: '', preview: false, viewAs: null, modes: ['simple', 'classic'], channels, prefs: {}, ...over });
const editor = { id: 'm-riley', name: 'Riley Jones', role: 'editor', realRole: 'editor', channelId: null, preview: false, modes: ['simple', 'classic'], hiddenPages: ['settings', 'knowledge', 'analytics', 'people'], nav: { main: ['home', 'reports', 'trends', 'assets', 'ask'], admin: [], bottom: [] }, allowed: ['askHelp', 'setViewPrefs', 'createAssetKit', 'planAssetKit'] };
const owner = { id: 'm-sam', name: 'Sam Lee', role: 'channel', realRole: 'channel', channelId: 'blog', channelName: 'Semrush Blog', preview: false, modes: ['simple'], allowed: ['setViewPrefs'] };
const studioState = (programs = [{ id: 'p1', name: 'SEO weekly', workspaceId: 'semrush' }]) => ({ keys: { APIFY_API_TOKEN: false, OPENAI_API_KEY: true }, contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs, researchRuns: [], contentRuns: [] } });
const model = (viewer, layout = 'simple', extra = {}) => buildNav({ viewer, layout, state: studioState(extra.programs), edition: 'semrush', counts: { waiting: 3 }, ...extra });
function sidebar(props = {}) {
  const viewer = props.viewer || admin();
  const mode = props.mode || 'simple';
  const handlers = { onSelectWorkspace: vi.fn(), onNewWorkspace: vi.fn(), onViewAs: vi.fn(), onMode: vi.fn(), onSignOut: vi.fn(), onNavigate: vi.fn(), onCreate: vi.fn(), onSearch: vi.fn(), onAsk: vi.fn(), onToggleRail: vi.fn(), onToggleDataTools: vi.fn(), onCloseDrawer: vi.fn(), onSaveFocusChannels: vi.fn(async () => {}) };
  const all = { edition: 'semrush', meta: { version: '0.3.0' }, web: false, viewer, nav: props.nav || model(viewer, mode), activeId: 'home', workspaces, activeWorkspaceId: 'semrush', mode, ...handlers, ...props };
  const frame = (over = {}) => <div className="app-shell studio-frame"><StudioSidebar {...all} {...over} /><div className="studio-main"><button type="button">In the page</button></div></div>;
  const view = render(frame());
  return { ...view, ...handlers, props: all, frame };
}
const narrow = () => { window.matchMedia = vi.fn((query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })); };
const main = () => within(screen.getByRole('navigation', { name: 'Main' }));

describe('StudioSidebar: head', () => {
  it('gives a real admin a workspace switcher with every workspace and New workspace', () => {
    const { onNewWorkspace, onSelectWorkspace } = sidebar();
    const switcher = screen.getByRole('button', { name: 'Workspace: Semrush workspace. Admin · Simple' });
    expect(switcher).toHaveAttribute('data-spot', 'nav.workspace');
    expect(switcher).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(switcher);
    const menu = screen.getByRole('menu', { name: 'Workspaces' });
    expect(within(menu).getAllByRole('menuitemradio').map((row) => [row.textContent, row.getAttribute('aria-checked')])).toEqual([['Semrush workspace', 'true'], ['General', 'false']]);
    expect(within(menu).getByRole('menuitemradio', { name: 'Semrush workspace' })).toHaveFocus();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'General' }));
    expect(onSelectWorkspace).toHaveBeenCalledWith('general');
    fireEvent.click(switcher);
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace' }));
    expect(onNewWorkspace).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(switcher).toHaveFocus();
  });

  it('asks before switching everyone’s workspace on the web', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { onSelectWorkspace } = sidebar({ web: true });
    const open = () => fireEvent.click(screen.getByRole('button', { name: /^Workspace:/ }));
    open(); fireEvent.click(screen.getByRole('menuitemradio', { name: 'General' }));
    expect(confirm).toHaveBeenCalledWith('Everyone using the studio, including channel owners, switches to General. Switch?');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    open(); fireEvent.click(screen.getByRole('menuitemradio', { name: 'General' }));
    expect(onSelectWorkspace).toHaveBeenCalledWith('general');
  });

  it('shows an editor their workspace and role as text, and a channel owner their channel', () => {
    sidebar({ viewer: editor });
    const card = screen.getByRole('group', { name: 'Workspace: Semrush workspace' });
    expect(card).toHaveAttribute('data-spot', 'nav.workspace');
    expect(card).toHaveTextContent('Editor · Simple');
    expect(screen.queryByRole('button', { name: /^Workspace:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
    cleanup();
    sidebar({ viewer: owner, mode: 'channel', activeId: 'trends' });
    const channel = screen.getByRole('group', { name: 'Your channel' });
    expect(channel).toHaveTextContent('Semrush Blog');
    expect(channel).toHaveTextContent('Channel owner · Semrush workspace');
    expect(screen.queryByRole('radiogroup', { name: 'Layout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^New/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search reports, trends and pages' })).not.toBeInTheDocument();
  });

  it('turns the switcher off while previewing and says who is being previewed', () => {
    sidebar({ viewer: admin({ role: 'editor', preview: true, viewAs: { role: 'editor' } }) });
    const switcher = screen.getByRole('button', { name: /^Workspace: Semrush workspace\. Viewing as Editor/ });
    expect(switcher).toBeDisabled();
    expect(switcher).toHaveAttribute('title', 'Buttons that change things are off in a preview.');
    expect(screen.getByRole('button', { name: /^Account: Alex Rivera, Viewing as Editor/ })).toBeInTheDocument();
  });

  it('collapses to a rail and back, keeping every name for screen readers', () => {
    const { onToggleRail, rerender, frame } = sidebar();
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse).toHaveAttribute('data-spot', 'nav.collapse');
    expect(collapse).toHaveAttribute('aria-keyshortcuts', 'Meta+\\');
    fireEvent.click(collapse);
    expect(onToggleRail).toHaveBeenCalled();
    rerender(frame({ rail: true }));
    const aside = document.getElementById('studio-sidebar');
    expect(aside).toHaveClass('is-rail');
    expect(aside).toHaveAttribute('data-rail');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    const trends = main().getByRole('button', { name: 'Trends, 3 need your OK' });
    expect(trends).not.toHaveAttribute('title');
    expect(trends).toHaveAttribute('data-tip', 'Trends, 3 need your OK · ⌘2');
    fireEvent.mouseOver(trends);
    expect(document.querySelector('.sb-tip')).toHaveTextContent('Trends, 3 need your OK · ⌘2');
    fireEvent.mouseLeave(aside);
    expect(document.querySelector('.sb-tip')).toBeNull();
  });
});

describe('StudioSidebar: New, Search and Ask AI', () => {
  it('opens New with every kind of new thing and hands the choice to onCreate', () => {
    const { onCreate } = sidebar({ viewer: admin({ web: true }) });
    const create = screen.getByRole('button', { name: /^New/ });
    expect(create).toHaveAttribute('data-spot', 'nav.new');
    expect(create).toHaveAttribute('aria-keyshortcuts', 'Alt+Meta+N');
    fireEvent.click(create);
    const menu = screen.getByRole('menu', { name: 'New' });
    expect(within(menu).getAllByRole('menuitem').map((row) => row.getAttribute('aria-label') || row.textContent)).toEqual(['Find new trends', 'Quick scan', 'Channel assets', 'Content from a report', 'Picture', 'Research program', 'Person', 'Workspace']);
    expect(within(menu).getByRole('menuitem', { name: 'Quick scan' })).toHaveAccessibleDescription('A small, recent scan, sized and priced by Ask AI.');
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    // Arrow keys move through the rows; Esc closes and gives focus back.
    expect(within(menu).getByRole('menuitem', { name: 'Find new trends' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Quick scan' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: 'Workspace' })).toHaveFocus();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Channel assets' }));
    expect(onCreate).toHaveBeenCalledWith('assets', { programId: '' });
    fireEvent.click(create);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find new trends' }));
    expect(onCreate).toHaveBeenLastCalledWith('research', { programId: 'p1' });
    fireEvent.click(create);
    fireEvent.keyDown(screen.getByRole('menu', { name: 'New' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(create).toHaveFocus();
  });

  it('lists each program under Find new trends when there are several, and opens from ⌥⌘N', () => {
    const viewer = admin();
    const nav = model(viewer, 'simple', { programs: [{ id: 'p1', name: 'SEO weekly', workspaceId: 'semrush' }, { id: 'p2', name: 'AI search', workspaceId: 'semrush' }] });
    const { onCreate, rerender, frame } = sidebar({ nav });
    rerender(frame({ newMenuKey: 1 }));
    const menu = screen.getByRole('menu', { name: 'New' });
    const group = within(menu).getByRole('group', { name: 'Find new trends' });
    expect(within(group).getAllByRole('menuitem').map((row) => row.textContent)).toEqual(['With SEO weekly', 'With AI search']);
    fireEvent.click(within(group).getByRole('menuitem', { name: 'With AI search' }));
    expect(onCreate).toHaveBeenCalledWith('research', { programId: 'p2' });
  });

  it('opens Search, and pins Ask AI as a page in Simple and a drawer in Advanced', () => {
    const { onSearch, onAsk, rerender, frame } = sidebar({ askCurrent: true });
    const search = screen.getByRole('button', { name: 'Search reports, trends and pages' });
    expect(search).toHaveAttribute('data-spot', 'nav.find');
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    fireEvent.click(search);
    expect(onSearch).toHaveBeenCalled();
    const ask = screen.getByRole('button', { name: 'Ask AI' });
    expect(ask).toHaveAttribute('data-spot', 'nav.ask');
    expect(ask).toHaveAttribute('aria-current', 'page');
    expect(ask).toHaveAttribute('aria-keyshortcuts', 'Meta+J');
    fireEvent.click(ask);
    expect(onAsk).toHaveBeenCalled();
    rerender(frame({ mode: 'classic', nav: model(admin(), 'classic'), askExpanded: true, activeId: 'overview' }));
    const drawerAsk = screen.getByRole('button', { name: 'Ask AI' });
    expect(drawerAsk).not.toHaveAttribute('aria-current');
    expect(drawerAsk).toHaveAttribute('aria-expanded', 'true');
    expect(drawerAsk).toHaveAttribute('aria-controls', 'help-drawer');
  });
});

describe('StudioSidebar: pages', () => {
  it('draws the groups, names badges in words, and keeps shortcuts in titles and aria-keyshortcuts', () => {
    const { onNavigate } = sidebar();
    expect(main().getAllByRole('group')).toHaveLength(2);
    expect(main().getByRole('group', { name: 'Pages' })).toBeInTheDocument();
    expect(main().getByRole('group', { name: 'Studio' })).toBeInTheDocument();
    const trends = main().getByRole('button', { name: 'Trends, 3 need your OK' }); // never "3Trends"
    expect(trends).toHaveAttribute('title', 'Trends (⌘2)');
    expect(trends).toHaveAttribute('aria-keyshortcuts', 'Meta+2');
    expect(trends).toHaveAttribute('data-spot', 'nav.trends');
    expect(trends.querySelector('.sb-badge')).toHaveAttribute('aria-hidden', 'true');
    expect(main().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(main().getByRole('button', { name: 'Settings, Apify isn’t connected' })).toHaveAttribute('aria-keyshortcuts', 'Meta+,');
    expect(within(main().getByRole('group', { name: 'Studio' })).getAllByRole('button').map((button) => button.querySelector('.sb-text').textContent)).toEqual(['Prompts', 'Analytics', 'People & access', 'Settings']);
    fireEvent.click(main().getByRole('button', { name: 'People & access' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'people', kind: 'admin', target: 'people' }));
  });

  it('opens and closes Data tools, and names the page open inside it when closed', () => {
    const viewer = admin();
    const { onToggleDataTools, rerender, frame } = sidebar({ mode: 'classic', nav: model(viewer, 'classic', { dataToolsOpen: false }), activeId: 'datasets' });
    const toggle = main().getByRole('button', { name: 'Data tools' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('data-spot', 'nav.data-tools');
    expect(toggle).toHaveAccessibleDescription('Open now: Datasets');
    expect(main().queryByRole('button', { name: 'Datasets' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggleDataTools).toHaveBeenCalled();
    rerender(frame({ mode: 'classic', nav: model(viewer, 'classic', { dataToolsOpen: true }), activeId: 'datasets' }));
    expect(main().getByRole('button', { name: 'Data tools' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(main().getByRole('group', { name: 'Analyze' })).getByRole('button', { name: 'Datasets' })).toHaveAttribute('aria-current', 'page');
    expect(main().getByRole('group', { name: 'Activity' })).toBeInTheDocument();
  });

  it('switches layout with native radios and keeps focus on the one pressed', () => {
    const { onMode, rerender, frame } = sidebar();
    const group = screen.getByRole('radiogroup', { name: 'Layout' });
    expect(group).toHaveAttribute('data-spot', 'nav.mode');
    const simple = within(group).getByRole('radio', { name: 'Simple' });
    const advanced = within(group).getByRole('radio', { name: 'Advanced' });
    expect(simple).toBeChecked();
    expect(advanced.closest('label')).toHaveAttribute('title', 'Every tool, including research programs, sheets and scrapers.');
    advanced.focus();
    fireEvent.click(advanced);
    expect(onMode).toHaveBeenCalledWith('classic');
    rerender(frame({ mode: 'classic', nav: model(admin(), 'classic'), activeId: 'overview' }));
    expect(within(screen.getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', { name: 'Advanced' })).toBe(advanced);
    expect(advanced).toBeChecked();
    expect(advanced).toHaveFocus();
    expect(main().getByRole('group', { name: 'Research' })).toBeInTheDocument();
  });
});

describe('StudioSidebar: footer', () => {
  it('shows live runs behind a Working button, each with Open and Stop', async () => {
    const onOpen = vi.fn(); const onStop = vi.fn(async () => {});
    sidebar({ working: { label: '2 running', runs: [{ id: 'r1', title: 'SEO weekly', kindLabel: 'Research', line: 'Collecting posts…', onOpen, onStop }, { id: 'k1', title: 'AI search', kindLabel: 'Channel assets', line: 'Starting soon' }] } });
    const button = screen.getByRole('button', { name: '2 running' });
    expect(button).toHaveAttribute('data-spot', 'top.working');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(button);
    const pop = screen.getByRole('dialog', { name: 'Working now' });
    expect(within(pop).getAllByRole('listitem')).toHaveLength(2);
    expect(pop).toHaveTextContent('Research · Collecting posts…');
    fireEvent.click(within(pop).getByRole('button', { name: 'Stop SEO weekly' }));
    expect(onStop).toHaveBeenCalled();
    fireEvent.click(within(pop).getByRole('button', { name: 'Open SEO weekly' }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Working now' })).not.toBeInTheDocument();
  });

  it('shows quick work as a plain status, and nothing when idle', () => {
    const { rerender, frame } = sidebar({ working: 'Importing the working sheet…' });
    expect(screen.getByRole('status')).toHaveTextContent('Importing the working sheet…');
    rerender(frame({ working: { label: '', runs: [] } }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('puts View as, My channels, Keyboard shortcuts and Sign out in the account menu', async () => {
    const { onViewAs, onSignOut, onSaveFocusChannels } = sidebar({ web: true });
    const account = screen.getByRole('button', { name: 'Account: Alex Rivera, Admin · Version 0.3.0' });
    expect(account).toHaveAttribute('data-spot', 'nav.account');
    fireEvent.click(account);
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(within(menu).getByRole('group', { name: 'View as' })).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['Admin (you)', 'Editor']);
    expect(within(within(menu).getByRole('group', { name: 'View as a channel owner' })).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['Semrush Blog', 'Semrush Social Team']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Admin (you)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Semrush Blog' }));
    expect(onViewAs).toHaveBeenCalledWith({ role: 'channel', channelId: 'blog' });

    fireEvent.click(account);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }));
    const keys = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(keys).getByText('Home').closest('.sb-keys-row')).toHaveTextContent('⌘1');
    expect(within(keys).getByText('Search reports, trends and pages')).toBeInTheDocument();
    fireEvent.click(within(keys).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();

    fireEvent.click(account);
    fireEvent.click(screen.getByRole('menuitem', { name: 'My channels…' }));
    const dialog = screen.getByRole('dialog', { name: 'My channels' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Semrush Blog' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSaveFocusChannels).toHaveBeenCalledWith(['blog']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'My channels' })).not.toBeInTheDocument());

    fireEvent.click(account);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('keeps Sign out off the Mac and View as away from anyone but a real admin', () => {
    sidebar({ viewer: editor });
    fireEvent.click(screen.getByRole('button', { name: /^Account: Riley Jones/ }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('lists custom roles in View as when the server sends them', () => {
    const { onViewAs } = sidebar({ viewer: admin({ roles: [{ id: 'role-viewer-ab12', label: 'Viewer', base: 'editor' }] }) });
    fireEvent.click(screen.getByRole('button', { name: /^Account:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Viewer' }));
    expect(onViewAs).toHaveBeenCalledWith({ role: 'role-viewer-ab12' });
  });
});

describe('StudioSidebar under 860px', () => {
  it('becomes a modal drawer: the page goes inert, focus moves in, Esc closes and focus returns', () => {
    narrow();
    const menu = document.createElement('button'); document.body.appendChild(menu); menu.focus();
    const { onCloseDrawer, rerender, frame, container } = sidebar({ drawerOpen: true });
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('id', 'studio-sidebar');
    expect(container.querySelector('.studio-main')).toHaveAttribute('inert');
    expect(within(drawer).getByRole('button', { name: 'Home' })).toHaveFocus();
    expect(within(drawer).queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reports' }));
    expect(onCloseDrawer).toHaveBeenCalledTimes(2);
    rerender(frame({ drawerOpen: false }));
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(container.querySelector('.studio-main')).not.toHaveAttribute('inert');
    expect(menu).toHaveFocus();
    menu.remove();
  });

  it('stays open for menus inside it, and gives focus back to the menu button even when a click didn’t focus it', () => {
    narrow();
    const onCloseDrawer = vi.fn();
    const nav = model(admin(), 'classic');
    const frame = (open) => <div className="app-shell studio-frame"><StudioTopBar title="Home" drawerOpen={open} onMenu={() => {}} /><StudioSidebar viewer={admin()} nav={nav} activeId="overview" workspaces={workspaces} activeWorkspaceId="semrush" mode="classic" drawerOpen={open} onCloseDrawer={onCloseDrawer} onNavigate={() => {}} onToggleDataTools={() => {}} /><div className="studio-main" /></div>;
    const { rerender } = render(frame(false));
    const menu = screen.getByRole('button', { name: 'Menu' });
    document.body.focus(); // Safari and Firefox on the Mac don't focus a button on click
    rerender(frame(true));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Data tools' }));
    fireEvent.click(within(drawer).getByRole('button', { name: /^Account:/ }));
    expect(onCloseDrawer).not.toHaveBeenCalled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Library' }));
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
    rerender(frame(false));
    expect(menu).toHaveFocus();
  });

  it('shows a top bar with the menu button, or the channel name and Sign out for channel owners', () => {
    narrow();
    const onMenu = vi.fn(); const onSignOut = vi.fn();
    const { rerender } = render(<StudioTopBar title="Trends" working={{ label: '1 running', runs: [] }} onMenu={onMenu} drawerOpen={false} />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'studio-sidebar');
    fireEvent.click(button);
    expect(onMenu).toHaveBeenCalled();
    expect(screen.getByText('Trends')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 running');
    rerender(<StudioTopBar mode="channel" channelName="Semrush Blog" web onSignOut={onSignOut} />);
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
    expect(screen.getByText('Semrush Blog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('gives channel owners a bottom nav instead of a drawer', () => {
    narrow();
    const onNavigate = vi.fn();
    const nav = buildNav({ viewer: owner, layout: 'channel', state: { contentStudio: { channelView: { counts: { newTrends: 2 } } } }, edition: 'semrush' });
    render(<ChannelBottomNav items={nav.groups[0].items} active="trends" onNavigate={onNavigate} />);
    const bottom = screen.getByRole('navigation', { name: 'Main' });
    expect(within(bottom).getByRole('button', { name: 'Trends, 2 new' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(bottom).getByRole('button', { name: 'My assets' }));
    expect(onNavigate).toHaveBeenCalledWith('assets');
  });

  it('renders neither the top bar nor the bottom nav on a wide window', () => {
    const { container } = render(<><StudioTopBar title="Trends" onMenu={() => {}} /><ChannelBottomNav items={[{ id: 'trends', label: 'Trends' }]} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('sidebar CSS', () => {
  it('keeps a window-drag strip over the main column in Simple and the channel screens on the Mac', () => {
    // Simple lost its full-width header, so without this the hiddenInset window drags only from the sidebar's top.
    const css = fs.readFileSync(path.resolve('src/renderer/src/studio-frame.css'), 'utf8');
    const rule = css.match(/\.is-desktop:is\(\[data-mode="simple"\], \[data-mode="channel"\]\) \.studio-main::before \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/-webkit-app-region: drag/);
    expect(rule?.[1]).toMatch(/pointer-events: none/);
    expect(css).toMatch(/\.studio-main \{[^}]*position: relative/);
  });

  it('sizes the rail from one token, defines dark values, and no longer styles every nav on the page', () => {
    const sidebarCss = fs.readFileSync(path.resolve('src/renderer/src/studio-sidebar.css'), 'utf8');
    expect(sidebarCss).toMatch(/\.studio-frame\[data-rail\] \{ --s-sidebar-width: var\(--s-rail-width\); \}/);
    expect(sidebarCss).toMatch(/:root\[data-theme="dark"\] \.studio-frame/);
    const frameCss = fs.readFileSync(path.resolve('src/renderer/src/studio-frame.css'), 'utf8');
    expect(frameCss).toMatch(/--s-on-accent: #181e15/);
    expect(frameCss).toMatch(/:root\[data-theme="dark"\] \.studio-frame/);
    for (const file of ['styles.css', 'premium.css']) {
      const css = fs.readFileSync(path.resolve(`src/renderer/src/${file}`), 'utf8');
      expect(css).not.toMatch(/(^|\n)nav button[ ,{:.]/); // page navs (.simple-pager, .cs-view-nav) style themselves
    }
  });
});
