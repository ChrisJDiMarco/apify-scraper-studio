// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import App from '../src/renderer/src/App.jsx';
import { CommandPalette } from '../src/renderer/src/command-palette.jsx';
import { LegacyLibrary } from '../src/renderer/src/legacy-library.jsx';
import { SheetsView } from '../src/renderer/src/sheets-view.jsx';
import { StudioSidebar } from '../src/renderer/src/studio-sidebar.jsx';
import { ariaKeys, buildNav } from '../src/renderer/src/nav-model.js';
import { isMac, keyLabel, place, revealLabel } from '../src/renderer/src/platform.js';

// The studio on Windows: shortcut labels read Ctrl, Alt and Shift where the Mac shows ⌘, ⌥ and ⇧, aria-keyshortcuts
// say Control instead of Meta (the Windows key), and the copy says this PC and File Explorer. test/setup-platform.js pins
// navigator.platform to MacIntel for every other suite; this one sets Win32 and puts the Mac back afterwards.
const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true });
beforeEach(() => setPlatform('Win32'));
afterEach(() => { cleanup(); setPlatform('MacIntel'); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush' }];
const admin = { id: 'local', name: 'Alex Rivera', email: '', role: 'admin', realRole: 'admin', channelId: null, channelName: '', preview: false, viewAs: null, modes: ['simple', 'classic'], channels: [], prefs: {} };
const studioState = { keys: { APIFY_API_TOKEN: true }, contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [{ id: 'p1', name: 'SEO weekly', workspaceId: 'semrush' }], researchRuns: [], contentRuns: [] } };
function sidebar(over = {}) {
  const nav = buildNav({ viewer: admin, layout: 'simple', state: studioState, edition: 'semrush', counts: {} });
  const handlers = { onNavigate: vi.fn(), onCreate: vi.fn(), onSearch: vi.fn(), onAsk: vi.fn(), onToggleRail: vi.fn(), onMode: vi.fn(), onSelectWorkspace: vi.fn(), onNewWorkspace: vi.fn() };
  render(<div className="app-shell studio-frame"><StudioSidebar edition="semrush" meta={{}} viewer={admin} nav={nav} activeId="home" workspaces={workspaces} activeWorkspaceId="semrush" mode="simple" {...handlers} {...over} /><div className="studio-main" /></div>);
  return nav;
}

describe('platform helpers', () => {
  it('reads Win32 as not a Mac and converts Mac shortcut data for display', () => {
    expect(isMac()).toBe(false);
    expect(['⌘K', '⌥⌘N', '⇧⌘Z', '⌘\\', '⌘,', '⌘-click', '⌫', '⇧Enter', 'Esc', '↑', ''].map((keys) => keyLabel(keys)))
      .toEqual(['Ctrl+K', 'Ctrl+Alt+N', 'Ctrl+Shift+Z', 'Ctrl+\\', 'Ctrl+,', 'Ctrl+click', 'Delete', 'Shift+Enter', 'Esc', '↑', '']);
    expect([ariaKeys('⌘1'), ariaKeys('⌥⌘N')]).toEqual(['Control+1', 'Alt+Control+N']);
    expect([place(), revealLabel()]).toEqual(['this PC', 'Show in File Explorer']);
  });

  it('leaves everything in Mac form on the Mac', () => {
    setPlatform('MacIntel');
    expect(isMac()).toBe(true);
    expect([keyLabel('⌥⌘N'), keyLabel('⌘-click'), ariaKeys('⌥⌘N'), place(), revealLabel()]).toEqual(['⌥⌘N', '⌘-click', 'Alt+Meta+N', 'this Mac', 'Show in Finder']);
  });
});

describe('labels on Windows', () => {
  it('shows Ctrl in the sidebar’s key caps, tooltips and aria-keyshortcuts, and says On this PC', () => {
    sidebar();
    const search = screen.getByRole('button', { name: 'Search reports, trends and pages' });
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    expect(search).toHaveAttribute('title', 'Search reports, trends and pages (Ctrl+K)');
    expect(search.querySelector('.sb-kbd')).toHaveTextContent('Ctrl+K');
    const create = screen.getByRole('button', { name: /^New/ });
    expect(create).toHaveAttribute('aria-keyshortcuts', 'Alt+Control+N');
    expect(create.querySelector('.sb-kbd')).toHaveTextContent('Ctrl+Alt+N');
    expect(screen.getByRole('button', { name: /^Ask AI/ }).querySelector('.sb-kbd')).toHaveTextContent('Ctrl+J');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('title', 'Collapse sidebar (Ctrl+\\)');
    const home = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Home/ });
    expect(home).toHaveAttribute('aria-keyshortcuts', 'Control+1');
    expect(home).toHaveAttribute('title', 'Home (Ctrl+1)');
    expect(document.body.textContent).not.toMatch(/[⌘⌥]/);
    expect(screen.getByText(/On this PC/)).toBeInTheDocument();
  });

  it('shows word key caps in the Keyboard shortcuts dialog, with no Use Ctrl hint', () => {
    sidebar();
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const home = within(dialog).getByText('Home').closest('.sb-keys-row');
    expect([...home.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['Ctrl', '1']);
    expect(home.querySelector('dd')).toHaveAttribute('aria-label', 'Control 1');
    const create = within(dialog).getByText('New').closest('.sb-keys-row');
    expect([...create.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['Ctrl', 'Alt', 'N']);
    expect(within(dialog).getByText('Start a new line').closest('.sb-keys-row')).toHaveTextContent('ShiftEnter');
    expect(dialog).not.toHaveTextContent(/⌘|⌥|Use Ctrl/);
  });

  it('shows Ctrl+1 in the command palette', () => {
    render(<CommandPalette open items={[{ id: 'page-home', label: 'Open Home', shortcut: '⌘1', action: 'navigate' }]} onClose={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Open Home/ }).querySelector('.palette-shortcut')).toHaveTextContent('Ctrl+1');
  });

  it('labels Sheets undo and redo the Windows way, and the link hint Ctrl+click', async () => {
    const workbook = { id: 'w1', name: 'Links', kind: 'imported', status: 'succeeded', edits: { version: 1, sheets: {} }, sheets: [{ id: 's1', name: 'Posts', columns: ['post_url'], rows: [['https://example.com/a']], rowKeys: ['r1'] }] };
    const api = { listWorkbooks: vi.fn(async () => [{ id: 'w1', kind: 'imported', name: 'Links', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', status: 'succeeded', rowCount: 1 }]), readWorkbook: vi.fn(async () => workbook), saveWorkbookEdits: vi.fn(async () => ({})), openSourceUrl: vi.fn() };
    render(<SheetsView api={api} state={{}} onNavigate={vi.fn()} />);
    await screen.findByRole('grid');
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('title', 'Redo (Ctrl+Y)');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (Ctrl+Z)');
    expect(document.querySelector('.sheet-link').getAttribute('title')).toBe('https://example.com/a\nCtrl+click to open');
  });

  it('says Show in File Explorer on reveal buttons', () => {
    render(<LegacyLibrary state={{ assets: [{ id: 'a1', title: 'Launch notes', type: 'brief', assetPath: '/tmp/a1.md', createdAt: '2026-10-01T12:00:00Z' }] }} onOpenAsset={vi.fn()} onRevealAsset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Show in File Explorer' })).toBeInTheDocument();
  });
});

describe('the frame and keys on Windows', () => {
  const emptyState = () => ({ projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: {}, settings: { maxItems: 1000, sheets: {}, uiMode: 'classic' }, v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } } });
  async function openApp() {
    window.apifyStudio = { appMeta: vi.fn(async () => ({ version: 'test', runtime: 'desktop' })), state: vi.fn(async () => emptyState()), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [], rawItems: [] })),
      // Ask AI gives the sidebar a New menu (Quick scan), which Ctrl+Alt+N opens.
      askHelp: vi.fn(async () => ({ answer: '' })), startQuickScan: vi.fn(), listHelpImages: vi.fn(async () => []) };
    render(<App />);
    await screen.findByRole('heading', { name: /Research your market/ });
    return document.querySelector('.studio-frame');
  }
  const newMenu = () => screen.queryByRole('menu', { name: 'New' });

  it('marks the frame as not a Mac, so the traffic-light padding and drag strips stay off', async () => {
    const frame = await openApp();
    expect(frame).toHaveClass('is-desktop');
    expect(frame).toHaveAttribute('data-platform', 'other');
  });

  it('lets AltGr+N type its letter and opens New on Ctrl+Alt+N', async () => {
    await openApp();
    await waitFor(() => expect(document.querySelector('.sb-create')).toBeInTheDocument());
    // Polish (Programmers): AltGr+N arrives as Ctrl+Alt with the KeyN code and types ń.
    expect(fireEvent.keyDown(window, { key: 'ń', code: 'KeyN', ctrlKey: true, altKey: true })).toBe(true);
    expect(newMenu()).not.toBeInTheDocument();
    // AltGr reported as such is never a shortcut, even when the layout leaves the letter as n.
    expect(fireEvent.keyDown(window, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, modifierAltGraph: true })).toBe(true);
    expect(newMenu()).not.toBeInTheDocument();
    expect(fireEvent.keyDown(window, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })).toBe(false);
    expect(await screen.findByRole('menu', { name: 'New' })).toBeInTheDocument();
  });

  it('opens New on Ctrl+Alt+N with a non-Latin layout, where the key reports the layout’s letter', async () => {
    await openApp();
    await waitFor(() => expect(document.querySelector('.sb-create')).toBeInTheDocument());
    // Czech AltGr+N types } and stays a character even when the AltGraph flag is missing.
    expect(fireEvent.keyDown(window, { key: '}', code: 'KeyN', ctrlKey: true, altKey: true })).toBe(true);
    expect(newMenu()).not.toBeInTheDocument();
    // Russian has no AltGr level, so Ctrl+Alt+N arrives as the layout's т on the KeyN code.
    expect(fireEvent.keyDown(window, { key: 'т', code: 'KeyN', ctrlKey: true, altKey: true })).toBe(false);
    expect(await screen.findByRole('menu', { name: 'New' })).toBeInTheDocument();
  });

  it('still opens New on the Mac’s ⌥⌘N, where ⌥N is a dead key', async () => {
    setPlatform('MacIntel');
    const frame = await openApp();
    expect(frame).toHaveAttribute('data-platform', 'mac');
    await waitFor(() => expect(document.querySelector('.sb-create')).toBeInTheDocument());
    expect(fireEvent.keyDown(window, { key: 'Dead', code: 'KeyN', metaKey: true, altKey: true, modifierAltGraph: true })).toBe(false);
    expect(await screen.findByRole('menu', { name: 'New' })).toBeInTheDocument();
  });
});

describe('traffic-light CSS', () => {
  it('applies the Mac title-bar padding and drag strips only to data-platform="mac"', () => {
    const css = ['studio-frame.css', 'studio-sidebar.css'].map((name) => fs.readFileSync(path.resolve('src/renderer/src', name), 'utf8')).join('\n');
    const rules = css.split('}').map((rule) => rule.trim()).filter((rule) => rule.includes('.is-desktop'));
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const rule of rules) expect(rule.slice(0, rule.indexOf('{')).split(',').every((selector) => !selector.includes('.is-desktop') || selector.includes('[data-platform="mac"].is-desktop'))).toBe(true);
    expect(css).toMatch(/\[data-platform="mac"\]\.is-desktop \.studio-topbar \{ padding-left: 84px;/);
  });
});
