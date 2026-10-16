// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BarChart3, FileText, Home, Images, MessageCircle, TrendingUp, Users } from 'lucide-react';
import { ChannelBottomNav, SidebarNav, StudioSidebar, StudioTopBar } from '../src/renderer/src/studio-sidebar.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.matchMedia; });
const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }, { id: 'general', name: 'General', editionId: 'general' }];
const channels = [{ id: 'blog', name: 'Semrush Blog', short: 'Blog' }, { id: 'social', name: 'Semrush Social Team', short: 'Social' }];
const admin = (over = {}) => ({ id: 'local', name: 'Chris DiMarco', email: '', role: 'admin', realRole: 'admin', channelId: null, channelName: '', preview: false, viewAs: null, modes: ['simple', 'classic'], channels, prefs: {}, ...over });
const editor = { id: 'm-riley', name: 'Riley Jones', role: 'editor', realRole: 'editor', channelId: null, preview: false, modes: ['simple', 'classic'] };
const owner = { id: 'm-alex', name: 'Alex Smith', role: 'channel', realRole: 'channel', channelId: 'blog', channelName: 'Semrush Blog', preview: false, modes: ['simple'] };
const MAIN = [{ id: 'home', label: 'Home', icon: Home, shortcut: '⌘1' }, { id: 'reports', label: 'Reports', icon: FileText, shortcut: '⌘2' }, { id: 'trends', label: 'Trends', icon: TrendingUp, shortcut: '⌘3', count: 3 }, { id: 'assets', label: 'Assets', icon: Images, shortcut: '⌘4' }, { id: 'ask', label: 'Ask AI', icon: MessageCircle, shortcut: '⌘5' }];
const ADMIN = [{ id: 'analytics', label: 'Analytics', icon: BarChart3, spot: 'nav.analytics' }, { id: 'people', label: 'People & roles', icon: Users, spot: 'nav.people' }];
function sidebar(props = {}) {
  const handlers = { onSelectWorkspace: vi.fn(), onNewWorkspace: vi.fn(), onViewAs: vi.fn(), onMode: vi.fn(), onSignOut: vi.fn(), onAdminNavigate: vi.fn(), onSettings: vi.fn(), onCloseDrawer: vi.fn() };
  const all = { edition: 'semrush', meta: { version: '0.3.0' }, web: false, viewer: admin(), workspaces, activeWorkspaceId: 'semrush', mode: 'simple', ...handlers, ...props };
  const view = render(<div className="app-shell studio-frame"><StudioSidebar {...all}><SidebarNav ariaLabel="Main" items={MAIN} active="home" onNavigate={vi.fn()} /></StudioSidebar><div className="studio-main"><button type="button">In the page</button></div></div>);
  return { ...view, ...handlers, props: all };
}
const narrow = () => { window.matchMedia = vi.fn((query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })); };

describe('StudioSidebar: who you are', () => {
  it('gives a real admin the workspace picker and a View as card with every role and channel', () => {
    const handlers = sidebar();
    expect(screen.getAllByLabelText('Content workspace')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Content workspace' })).toHaveValue('semrush');
    const viewAs = screen.getByRole('combobox', { name: 'View as' });
    expect(viewAs).toHaveValue('admin');
    expect(within(viewAs).getAllByRole('option').map((option) => option.textContent)).toEqual(['Admin (you)', 'Editor', 'Semrush Blog', 'Semrush Social Team']);
    expect(within(viewAs).getByRole('group', { name: 'Channel owner' })).toBeInTheDocument();
    const card = viewAs.closest('label');
    expect(card).toHaveTextContent('View as');
    expect(card).toHaveTextContent('Admin (you)');
    expect(card.closest('[data-spot="nav.role"]')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Content workspace' }).closest('[data-spot="nav.workspace"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New workspace' }));
    expect(handlers.onNewWorkspace).toHaveBeenCalled();
  });

  it('shows an editor their workspace and role as text, never as a select', () => {
    sidebar({ viewer: editor });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const role = document.querySelector('[data-spot="nav.role"]');
    expect(role).toHaveTextContent('Editor');
    expect(role).toHaveTextContent('Writes and edits reports');
    expect(document.querySelector('[data-spot="nav.workspace"]')).toHaveTextContent('Semrush workspaceWorkspace');
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
  });

  it('gives a channel owner one merged card and no layout switch', () => {
    sidebar({ viewer: owner, mode: 'channel' });
    const card = screen.getByRole('group', { name: 'Your channel' });
    expect(card).toHaveTextContent('Semrush Blog');
    expect(card).toHaveTextContent('Channel owner · Semrush workspace');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Layout' })).not.toBeInTheDocument();
  });

  it('commits View as 350ms after the last change, once', () => {
    vi.useFakeTimers();
    const { onViewAs } = sidebar();
    const viewAs = screen.getByRole('combobox', { name: 'View as' });
    fireEvent.change(viewAs, { target: { value: 'editor' } });
    expect(viewAs.closest('label')).toHaveTextContent('Editor');
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(viewAs, { target: { value: 'channel:blog' } });
    act(() => { vi.advanceTimersByTime(349); });
    expect(onViewAs).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onViewAs).toHaveBeenCalledTimes(1);
    expect(onViewAs).toHaveBeenCalledWith({ role: 'channel', channelId: 'blog' });
  });

  it('marks the card while previewing, and going back to Admin clears the preview', () => {
    vi.useFakeTimers();
    const { onViewAs } = sidebar({ viewer: admin({ role: 'channel', channelId: 'blog', channelName: 'Semrush Blog', preview: true, viewAs: { role: 'channel', channelId: 'blog' } }), mode: 'channel' });
    const viewAs = screen.getByRole('combobox', { name: 'View as' });
    expect(viewAs).toHaveValue('channel:blog');
    const card = viewAs.closest('label');
    expect(card).toHaveAttribute('data-preview');
    expect(card).toHaveTextContent('Preview');
    expect(card).toHaveTextContent('Semrush Blog');
    // The workspace switch is a write, so it's off while previewing.
    expect(screen.getByRole('combobox', { name: 'Content workspace' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '+ New workspace' })).not.toBeInTheDocument();
    fireEvent.change(viewAs, { target: { value: 'admin' } });
    act(() => { vi.advanceTimersByTime(350); });
    expect(onViewAs).toHaveBeenCalledWith({ role: 'admin' });
  });

  it('brings focus back to View as when the preview ends from the banner', () => {
    const { rerender, props } = sidebar({ viewer: admin({ role: 'editor', preview: true, viewAs: { role: 'editor' } }) });
    document.activeElement?.blur?.();
    rerender(<div className="app-shell studio-frame"><StudioSidebar {...props} viewer={admin()} /><div className="studio-main" /></div>);
    expect(screen.getByRole('combobox', { name: 'View as' })).toHaveFocus();
  });

  it('asks before switching everyone’s workspace on the web', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { onSelectWorkspace } = sidebar({ web: true });
    fireEvent.change(screen.getByRole('combobox', { name: 'Content workspace' }), { target: { value: 'general' } });
    expect(confirm).toHaveBeenCalledWith('Everyone using the studio, including channel owners, switches to General. Switch?');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Content workspace' }), { target: { value: 'general' } });
    expect(onSelectWorkspace).toHaveBeenCalledWith('general');
  });
});

describe('StudioSidebar: layout and navigation', () => {
  it('switches layout with native radios and keeps focus on the one pressed', () => {
    const { onMode, rerender, props } = sidebar();
    const group = screen.getByRole('radiogroup', { name: 'Layout' });
    expect(group).toHaveAttribute('data-spot', 'nav.mode');
    expect(group.closest('nav')).toBeNull();
    const simple = within(group).getByRole('radio', { name: 'Simple' });
    const advanced = within(group).getByRole('radio', { name: 'Advanced' });
    expect(simple).toBeChecked();
    expect(advanced.closest('label')).toHaveAttribute('title', 'Every tool, including research programs, sheets and scrapers.');
    advanced.focus();
    fireEvent.click(advanced);
    expect(onMode).toHaveBeenCalledWith('classic');
    rerender(<div className="app-shell studio-frame"><StudioSidebar {...props} mode="classic"><nav aria-label="Primary"><button type="button">Overview</button></nav></StudioSidebar><div className="studio-main" /></div>);
    expect(within(screen.getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', { name: 'Advanced' })).toBe(advanced);
    expect(advanced).toBeChecked();
    expect(advanced).toHaveFocus();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('renders the Main nav with counts, and shortcuts only in titles', () => {
    sidebar();
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getAllByRole('button').map((button) => button.textContent.replace(/\d+/g, ''))).toEqual(['Home', 'Reports', 'Trends', 'Assets', 'Ask AI']);
    const trends = within(main).getByRole('button', { name: /Trends/ });
    expect(trends).toHaveAttribute('title', 'Trends (⌘3)');
    expect(trends).toHaveAttribute('aria-keyshortcuts', 'Meta+3');
    expect(trends).toHaveAttribute('data-spot', 'nav.trends');
    expect(trends).toHaveAccessibleName('Trends, 3 new'); // never "3Trends"
    expect(trends.querySelector('.simple-count')).toHaveAttribute('aria-hidden', 'true');
    expect(within(main).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('adds a separate Admin nav, then Settings, the working indicator and the footer', () => {
    const { onAdminNavigate, onSettings, onSignOut } = sidebar({ adminItems: ADMIN, activeAdmin: 'analytics', showSettings: true, working: 2, web: true });
    const adminNav = screen.getByRole('navigation', { name: 'Admin' });
    expect(adminNav).toHaveTextContent('Admin');
    expect(within(adminNav).getByRole('button', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page');
    expect(within(adminNav).getByRole('button', { name: 'Analytics' })).toHaveAttribute('data-spot', 'nav.analytics');
    fireEvent.click(within(adminNav).getByRole('button', { name: 'People & roles' }));
    expect(onAdminNavigate).toHaveBeenCalledWith('people');
    const settings = within(screen.getByRole('navigation', { name: 'Preferences' })).getByRole('button', { name: 'Settings' });
    expect(settings).toHaveAttribute('data-spot', 'nav.settings');
    fireEvent.click(settings);
    expect(onSettings).toHaveBeenCalled();
    const working = screen.getByRole('status');
    expect(working).toHaveTextContent('2 jobs running');
    expect(working).toHaveAttribute('data-spot', 'top.working');
    expect(screen.getByText('Chris DiMarco')).toBeInTheDocument();
    expect(screen.getByText('Version 0.3.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('hides Sign out on the Mac and the Admin nav when there are no admin items', () => {
    sidebar();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Preferences' })).not.toBeInTheDocument();
  });
});

describe('StudioSidebar under 860px', () => {
  it('becomes a modal drawer: the page goes inert, focus moves in, Esc closes and focus returns', () => {
    narrow();
    const menu = document.createElement('button'); document.body.appendChild(menu); menu.focus();
    const { onCloseDrawer, rerender, props, container } = sidebar({ drawerOpen: true });
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('id', 'studio-sidebar');
    expect(container.querySelector('.studio-main')).toHaveAttribute('inert');
    expect(within(drawer).getByRole('button', { name: 'Home' })).toHaveFocus();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawer).getByRole('button', { name: /Reports/ }));
    expect(onCloseDrawer).toHaveBeenCalledTimes(2);
    rerender(<div className="app-shell studio-frame"><StudioSidebar {...props} drawerOpen={false}><SidebarNav ariaLabel="Main" items={MAIN} active="home" /></StudioSidebar><div className="studio-main" /></div>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.studio-main')).not.toHaveAttribute('inert');
    expect(menu).toHaveFocus();
    menu.remove();
  });

  it('stays open for a toggle inside a nav, and gives focus back to the menu button even when a click didn’t focus it', () => {
    narrow();
    const onCloseDrawer = vi.fn();
    const frame = (open) => <div className="app-shell studio-frame"><StudioTopBar title="Overview" drawerOpen={open} onMenu={() => {}} /><StudioSidebar viewer={admin()} workspaces={workspaces} activeWorkspaceId="semrush" mode="classic" drawerOpen={open} onCloseDrawer={onCloseDrawer}><nav aria-label="Primary"><button type="button" aria-current="page">Overview</button><button type="button" aria-expanded="false">More tools</button></nav></StudioSidebar><div className="studio-main" /></div>;
    const { rerender } = render(frame(false));
    const menu = screen.getByRole('button', { name: 'Menu' });
    document.body.focus(); // Safari and Firefox on the Mac don't focus a button on click
    rerender(frame(true));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'More tools' }));
    expect(onCloseDrawer).not.toHaveBeenCalled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Overview' }));
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
    rerender(frame(false));
    expect(menu).toHaveFocus();
  });

  it('shows a top bar with the menu button, or the channel name and Sign out for channel owners', () => {
    narrow();
    const onMenu = vi.fn(); const onSignOut = vi.fn();
    const { rerender } = render(<StudioTopBar title="Trends" working="Working…" onMenu={onMenu} drawerOpen={false} />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'studio-sidebar');
    fireEvent.click(button);
    expect(onMenu).toHaveBeenCalled();
    expect(screen.getByText('Trends')).toBeInTheDocument();
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
    render(<ChannelBottomNav items={[{ id: 'trends', label: 'Trends', icon: TrendingUp, count: 2 }, { id: 'assets', label: 'My assets', icon: Images }]} active="trends" onNavigate={onNavigate} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: /Trends/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('button', { name: 'My assets' }));
    expect(onNavigate).toHaveBeenCalledWith('assets');
  });

  it('keeps a window-drag strip over the main column in Simple and the channel screens on the Mac', () => {
    // Simple lost its full-width header, so without this the hiddenInset window drags only from the sidebar's top.
    const css = fs.readFileSync(path.resolve('src/renderer/src/studio-frame.css'), 'utf8');
    const rule = css.match(/\.is-desktop:is\(\[data-mode="simple"\], \[data-mode="channel"\]\) \.studio-main::before \{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/-webkit-app-region: drag/);
    expect(rule?.[1]).toMatch(/pointer-events: none/);
    expect(css).toMatch(/\.studio-main \{[^}]*position: relative/);
  });

  it('renders neither the top bar nor the bottom nav on a wide window', () => {
    const { container } = render(<><StudioTopBar title="Trends" onMenu={() => {}} /><ChannelBottomNav items={[{ id: 'trends', label: 'Trends' }]} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});
