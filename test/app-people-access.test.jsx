// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import { ActivityView } from '../src/renderer/src/activity-view.jsx';
import { ViewerContext } from '../src/renderer/src/viewer.js';
import roles from '../src/main/roles.js';
import teamStoreModule from '../src/main/team-store.js';
import fixture from './fixtures/roles-state.js';

// Hand-offs into People & access and the data-tools pages, through the real App: what was clicked is what opens, an
// unsaved Roles draft is asked about before a preview drops it, and a role without data tools gets no side door into
// Activity (whose spend tile would say $0.00 to someone who can't see costs).
const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key), clear: () => stored.clear() } });
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

// The access summary and policy come from the real team store, with a custom editor-based "Viewer" role (no data tools,
// no costs), as an admin would make it in Roles.
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-people-access-'));
afterAll(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
const store = teamStoreModule.createTeamStore({ root: storeRoot });
const viewerRole = store.saveRole({ label: 'Viewer', base: 'editor', template: 'viewer', rev: 0 }, { id: 'owner', name: 'Studio admin' }).role;
const ACCESS = store.accessSummary();
const policy = store.accessPolicy();
const person = (fields) => { const def = policy.roles.get(fields.role); return { email: '', channelId: null, disabled: false, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '', serverAdmin: false, link: null, grants: [], denies: [], ...fields, roleLabel: def.label, base: def.base, capabilities: roles.capabilitiesFor({ roleId: fields.role, grants: [], denies: [] }, policy) }; };
const members = [
  person({ id: 'm-chris', name: 'Chris DiMarco', role: 'admin' }),
  person({ id: 'm-riley', name: 'Riley Jones', email: 'riley@semrush.com', role: 'editor' }),
];
const team = () => ({ members, channels: [{ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [] }], signIn: { web: false }, access: ACCESS });

// The Mac app in the Advanced layout as its local admin (no state.viewer: everything is allowed).
async function openAdvanced(extra = {}) {
  const workspaces = [{ id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: {}, products: [] }];
  const state = { projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }, settings: { maxItems: 1000, sheets: {}, uiMode: 'classic' }, v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'semrush', workspaces, programs: [], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {} } };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
    contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), readHelpImage: vi.fn(async () => ({})),
    setViewPrefs: vi.fn(async () => ({})), saveSettings: vi.fn(async () => ({})), setViewAs: vi.fn(async () => ({})),
    getTeam: vi.fn(async () => team()), saveRolePolicy: vi.fn(async () => ({ access: ACCESS })), readAccessLog: vi.fn(async () => ({ rows: [], more: false })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: /^This week in/ });
  return api;
}
const openPalette = async (text) => {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  const palette = await screen.findByRole('dialog', { name: 'Command palette' });
  fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: text } });
  return palette;
};

describe('People & access hand-offs', () => {
  it('⌘K “People: Riley Jones” opens People & access with Riley’s sheet open', async () => {
    await openAdvanced();
    const palette = await openPalette('Riley');
    fireEvent.click(await within(palette).findByRole('button', { name: /People: Riley Jones/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Riley Jones' });
    expect(within(sheet).getByRole('tab', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1, name: 'People & access' }).length).toBeGreaterThan(0);
  });

  it('asks before a preview throws away unsaved role changes, and previews only once the person agrees', async () => {
    const api = await openAdvanced();
    const palette = await openPalette('People & access');
    fireEvent.click(await within(palette).findByRole('button', { name: /People & access/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Roles' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Editor: See team analytics' }));
    expect(screen.getByRole('region', { name: 'Unsaved role changes' })).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Preview as…/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Preview what someone sees' })).getByRole('button', { name: 'Preview' }));
    expect(confirm).toHaveBeenCalledWith('Leave without saving your edits?');
    expect(api.setViewAs).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: /^Editor: See team analytics, not saved yet/ })).toHaveAttribute('aria-checked', 'true');
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Preview as…/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Preview what someone sees' })).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.setViewAs).toHaveBeenCalledWith({ role: 'editor' }));
  });
});

describe('Data tools follow the role', () => {
  // A custom editor-based Viewer (no data tools, no See costs), signed in to the Mac app's shell in Advanced.
  const identity = { id: 'member-val', name: 'Val', email: 'val@semrush.com', role: viewerRole.id, channelId: null, via: 'link', memberSince: '2026-08-01T00:00:00.000Z' };
  const viewer = roles.buildViewer({ identity, prefs: { uiMode: 'classic' }, editionId: 'semrush', admins: [{ id: 'member-chris', name: 'Chris' }], policy });

  it('gives a role without data tools no Open into Activity from a running job', async () => {
    expect(viewer.hiddenPages).toContain('data-tools');
    expect(viewer.hiddenPages).not.toContain('runs');
    const base = fixture.baseState();
    base.jobs = [{ id: 'job-1', kind: 'scraper-run', title: 'X search', status: 'running', createdAt: '2026-10-17T09:00:00.000Z' }];
    const projected = roles.projectState(base, viewer, { adoptions: [], admins: [{ id: 'member-chris', name: 'Chris' }], memberCount: 3, editionId: 'semrush' });
    window.apifyStudio = {
      appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => projected), onStateChanged: vi.fn(() => () => {}), readDataset: vi.fn(async () => ({ items: [] })),
      contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []), setViewPrefs: vi.fn(async () => ({})), saveSettings: vi.fn(async () => ({})),
    };
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /^This week in/ });
    fireEvent.click(screen.getAllByRole('button', { name: /\d+ running/ })[0]);
    const pop = await screen.findByRole('dialog', { name: 'Working now' });
    expect(within(pop).getByText('X search')).toBeInTheDocument();
    expect(within(pop).queryByRole('button', { name: 'Open X search' })).not.toBeInTheDocument();
  });

  it('shows AI spend in Activity only to someone who can see costs', () => {
    const state = { runs: [], analyses: [], jobs: [], datasets: [], recipes: [], contentStudio: { researchRuns: [{ id: 'r', type: 'research', title: 'Weekly', status: 'succeeded', createdAt: new Date().toISOString() }], contentRuns: [] } };
    const props = { state, busy: false, onRunRecipe: vi.fn(), onDatasetSelect: vi.fn(), onNavigate: vi.fn(), onOpenStudio: vi.fn(), onCancelJob: vi.fn() };
    const { unmount } = render(<ViewerContext.Provider value={viewer}><ActivityView {...props} /></ViewerContext.Provider>);
    expect(screen.getByText('Finished this week')).toBeInTheDocument();
    expect(screen.queryByText('AI spend this week')).not.toBeInTheDocument();
    unmount();
    render(<ActivityView {...props} />); // the Mac app's local admin
    expect(screen.getByText('AI spend this week')).toBeInTheDocument();
  });
});
