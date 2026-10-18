// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/renderer/src/settings-view.jsx';
import { SETTINGS_SECTION_IDS } from '../src/renderer/src/settings-sections.js';

// Settings' section nav: one link per section in page order with a status dot, jumps that open collapsed sections, keys
// that move between links, a Jump to menu on narrow screens, and #/settings/<section> requests.
const base = (extra = {}) => ({ keys: {}, settings: { maxItems: 1000, sheets: {} }, sheetRuns: [], ...extra });
// Every section present: a Monday.com stand-in through extraSections, so this doesn't depend on that build's component.
const props = (extra = {}) => ({ state: base(), meta: {}, onSaveKey: vi.fn(async () => true), onClearKey: vi.fn(), onSaveSettings: vi.fn(), setupApi: { previewAiRouting: vi.fn(() => new Promise(() => {})), getAiConnections: vi.fn(() => new Promise(() => {})), addBrandImage: vi.fn(), openSetupFile: vi.fn(), connectDriveSync: vi.fn() }, extraSections: { monday: () => <section className="settings-block"><h3>Monday.com</h3></section> }, ...extra });
let scrolled;
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); };
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });
const nav = () => screen.getByRole('navigation', { name: 'Settings sections' });

describe('Settings section nav', () => {
  it('links every section in page order, each with its status', () => {
    render(<SettingsView {...props()} />);
    const links = within(nav()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(SETTINGS_SECTION_IDS.map((id) => `#/settings/${id}`));
    expect(within(nav()).getByRole('link', { name: /Source collection, Not connected/ })).toBeInTheDocument();
    expect(within(nav()).getByRole('link', { name: /AI connections, Not checked/ })).toBeInTheDocument();
    // Every section is on the page, wrapped in its anchor.
    for (const id of SETTINGS_SECTION_IDS) expect(document.querySelector(`[data-settings-section="${id}"]`)).toBeInTheDocument();
    expect(within(nav()).getAllByText('Collection')[0]).toHaveClass('settings-nav-group');
  });

  it('jumps to a section and opens it when it is collapsed', () => {
    render(<SettingsView {...props()} />);
    const docs = document.querySelector('#settings-google-docs details');
    expect(docs.open).toBe(false);
    fireEvent.click(within(nav()).getByRole('link', { name: /Google Docs/ }), { detail: 1 });
    expect(scrolled).toContain('settings-google-docs');
    expect(docs.open).toBe(true);
    expect(within(nav()).getByRole('link', { name: /Google Docs/ })).toHaveAttribute('aria-current', 'location');
    // ⌘-click is left to the browser (open the link elsewhere).
    scrolled = [];
    fireEvent.click(within(nav()).getByRole('link', { name: /Studio web address/ }), { metaKey: true });
    expect(scrolled).toEqual([]);
  });

  it('moves between links with the arrow keys, Home and End', () => {
    render(<SettingsView {...props()} />);
    const links = within(nav()).getAllByRole('link');
    links[0].focus();
    fireEvent.keyDown(links[0], { key: 'ArrowDown' }); expect(links[1]).toHaveFocus();
    fireEvent.keyDown(links[1], { key: 'ArrowUp' }); expect(links[0]).toHaveFocus();
    fireEvent.keyDown(links[0], { key: 'End' }); expect(links[links.length - 1]).toHaveFocus();
    fireEvent.keyDown(links[links.length - 1], { key: 'Home' }); expect(links[0]).toHaveFocus();
  });

  it('offers a Jump to menu on narrow screens', () => {
    render(<SettingsView {...props({ narrow: true })} />);
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    const jump = screen.getByLabelText('Jump to');
    expect(within(jump).getByRole('option', { name: 'Source collection · Not connected' })).toBeInTheDocument();
    expect(jump.querySelectorAll('optgroup').length).toBe(5);
    fireEvent.change(jump, { target: { value: 'diagnostics' } });
    expect(scrolled).toContain('settings-diagnostics');
    expect(document.querySelector('#settings-diagnostics details').open).toBe(true);
  });

  it('opens the section a request names, once per request', () => {
    const { rerender } = render(<SettingsView {...props({ request: { key: 1, section: 'monday' } })} />);
    expect(scrolled).toEqual(['settings-monday']);
    rerender(<SettingsView {...props({ request: { key: 1, section: 'monday' } })} />);
    expect(scrolled).toEqual(['settings-monday']);
    rerender(<SettingsView {...props({ request: { key: 2, section: 'images' } })} />); // an older name for AI connections
    expect(scrolled).toEqual(['settings-monday', 'settings-ai']);
    rerender(<SettingsView {...props({ request: { key: 3, section: 'nowhere' } })} />);
    expect(scrolled).toHaveLength(2);
  });

  it('names unreadable keys and set-aside data files in diagnostics', () => {
    render(<SettingsView {...props({ state: base({ keys: { APIFY_API_TOKEN: true }, keyProblems: { APIFY_API_TOKEN: 'mismatch' }, storeRecovery: [{ store: 'Studio settings', file: 'config.json', kept: 'config.json.bad-1' }] }) })} />);
    const alert = within(document.querySelector('#settings-diagnostics')).getByRole('alert');
    expect(alert).toHaveTextContent('The saved Apify token can’t be read with this studio’s secret key');
    expect(alert).toHaveTextContent('Studio settings (config.json) was damaged');
    expect(within(nav()).getByRole('link', { name: /Connection diagnostics, Needs attention/ })).toBeInTheDocument();
  });

  it('says a one-workspace build has one workspace and what it keeps hidden', () => {
    const contentStudio = { activeWorkspaceId: 'semrush', workspaces: [{ id: 'semrush', name: 'Main', editionId: 'semrush' }], workspacePolicy: { mode: 'single', name: 'Main', editionId: 'semrush', archived: [{ id: 'general', name: 'Your workspace', programs: 2, runs: 5, assets: 0 }] } };
    render(<SettingsView {...props({ state: base({ contentStudio }) })} />);
    const details = document.querySelector('#settings-details');
    expect(details).toHaveTextContent('Workspace: Main (Semrush edition). This build has one workspace.');
    expect(details).toHaveTextContent('Kept on disk, hidden in this build: Your workspace (2 programs, 5 runs).');
  });

  it('shows no nav to someone who isn’t an admin', () => {
    render(<SettingsView {...props({ role: 'editor' })} />);
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settings are for admins' })).toBeInTheDocument();
  });
});
