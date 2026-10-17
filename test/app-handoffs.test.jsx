// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/src/App.jsx';
import roles from '../src/main/roles.js';
import teamStoreModule from '../src/main/team-store.js';
import fixture from './fixtures/roles-state.js';

// Hand-offs through the real App: what was clicked is what the next page shows (a run, a report, a folder, a brief), a
// request is spent once its page is left, and leaving unsaved edits asks once.
const stored = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key), clear: () => stored.clear() } });
afterEach(() => { cleanup(); delete window.apifyStudio; vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } window.history.replaceState(null, '', '/'); });

const GREETING = { level: 1, name: /^This week in/ };
const side = (id) => fireEvent.click(document.querySelector(`[data-spot="nav.${id}"]`));
const h1 = async (name) => (await screen.findAllByRole('heading', { level: 1, name }))[0];
const mode = () => document.querySelector('.app-shell')?.dataset.mode;
const runShown = () => within(screen.getByRole('region', { name: 'Run progress' })).getAllByRole('heading').map((node) => node.textContent);

// The roles fixture, projected for each role exactly as the main process sends it (as app-roles.test.jsx does).
const admins = [{ id: 'member-chris', name: 'Chris' }];
const identities = {
  admin: { id: 'local', name: 'Chris', email: '', role: 'admin', channelId: null, via: 'desktop' },
  channel: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', via: 'link', memberSince: fixture.at('10-01') },
};
function openStudio(who, { uiMode = 'simple', web = false, api: extra = {} } = {}) {
  const server = { who, viewAs: null, prefs: { uiMode, welcomedAt: '' }, base: fixture.baseState() };
  const project = () => {
    const viewer = roles.buildViewer({ identity: identities[server.who], session: { viewAs: server.viewAs }, prefs: server.prefs, editionId: 'semrush', web, admins });
    return roles.projectState(server.base, viewer, { adoptions: fixture.adoptions(), admins, memberCount: 5, editionId: 'semrush' });
  };
  const api = {
    appMeta: vi.fn(async () => ({ version: '0.3.0', ...(web ? { runtime: 'web' } : {}) })), state: vi.fn(async () => project()), onStateChanged: vi.fn(() => () => {}),
    readDataset: vi.fn(async () => ({ items: [] })), contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })), listHelpImages: vi.fn(async () => []),
    readStudioAsset: vi.fn(async ({ assetId }) => ({ markdown: `# Report ${assetId}\n\nOriginal text.` })),
    editStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId } })), restoreStudioAsset: vi.fn(async ({ assetId }) => ({ asset: { id: assetId } })),
    setViewAs: vi.fn(async (payload) => { server.viewAs = payload.role === 'admin' ? null : payload; return { viewer: project().viewer }; }),
    setViewPrefs: vi.fn(async (patch) => { server.prefs = { ...server.prefs, ...patch }; return { viewer: project().viewer }; }),
    saveSettings: vi.fn(async () => true), startResearchRun: vi.fn(async () => ({ id: 'research-next' })), decideResearchTheme: vi.fn(async () => true),
    getTeam: vi.fn(async () => ({ members: [], channels: [], signIn: { web: false } })), getTrendAnalytics: vi.fn(async () => null), selectContentWorkspace: vi.fn(async () => true),
    setTrendAdoption: vi.fn(async () => ({ adoption: null })), openSourceUrl: vi.fn(async () => true), askHelp: vi.fn(async () => ({ answer: 'Sure.', pages: [], followUps: [], actions: [] })),
    listPrompts: vi.fn(async () => ({ prompts: [], groups: [] })),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  return { api, server };
}

// A studio of our own: two programs, so "the newest program's newest run" is never the run that was clicked.
const sg = [{ id: 'x', sourceId: 'x', platform: 'x', name: 'X accounts', targets: ['apify'], enabled: true, options: {} }];
const program = (id, name, createdAt) => ({ id, workspaceId: 'general', name, sourceGroups: sg, budgets: { collectionUsd: 1, aiUsd: 5 }, createdAt, updatedAt: createdAt });
const newest = program('p1', 'Newest program', '2026-10-10T00:00:00Z');
const older = program('p2', 'Older program', '2026-09-01T00:00:00Z');
const runOfNewest = { id: 'r1', workspaceId: 'general', programId: 'p1', title: 'Run of newest', status: 'succeeded', createdAt: '2026-10-11T00:00:00Z' };
const failedOlder = { id: 'r2', workspaceId: 'general', programId: 'p2', title: 'Failed run of older', status: 'failed', error: 'Apify token missing', createdAt: '2026-10-12T00:00:00Z' };
async function boot(studio = {}, { uiMode = 'simple', edition = 'general', wait = true, api: extra = {} } = {}) {
  const workspaces = [{ id: 'general', name: 'My brand', editionId: edition, knowledge: {}, products: [] }];
  const state = { projects: [], recipes: [], datasets: [], cards: [], assets: [], runs: [], analyses: [], jobs: [], keys: { APIFY_API_TOKEN: true }, settings: { maxItems: 1000, sheets: {}, uiMode }, v5: { missions: [], jobs: [], recipeVersions: {}, commandPalette: [], evidenceSummary: { sample: [] } },
    contentStudio: { activeWorkspaceId: 'general', workspaces, programs: [], researchRuns: [], contentRuns: [], assets: [], availableDatasets: [], availableReports: [], capabilities: {}, ...studio } };
  const api = {
    appMeta: vi.fn(async () => ({ version: 'test' })), state: vi.fn(async () => state), onStateChanged: vi.fn(() => () => {}), contentCatalog: vi.fn(async () => ({ editions: [], deliverables: [] })),
    listHelpImages: vi.fn(async () => []), readStudioAsset: vi.fn(async () => ({ markdown: '# x' })), setViewPrefs: vi.fn(async () => ({})), saveSettings: vi.fn(async () => ({})),
    cancelStudioRun: vi.fn(async () => true), retryStudioRun: vi.fn(async () => true), readTrendHistory: vi.fn(async () => null), estimateResearchProgram: vi.fn(async () => null),
    ...extra,
  };
  window.apifyStudio = api;
  render(<App />);
  if (wait) await screen.findByRole('heading', GREETING);
  return api;
}

describe('Create content keeps what the Trend board handed it (the original bug)', () => {
  it('Advanced Trend board › Create content on a ready trend opens Create content with that report attached', async () => {
    const { api } = openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    side('board');
    await h1('Trend board');
    const ready = [...document.querySelectorAll('.tb-card')].filter((node) => node.getAttribute('aria-label') === 'AI Overviews eat clicks' && within(node).queryByRole('button', { name: /^Create (more )?content$/ }));
    expect(ready.length).toBeGreaterThan(0);
    fireEvent.click(within(ready[0]).getByRole('button', { name: /^Create (more )?content$/ }));
    await h1('Create content');
    await waitFor(() => expect(api.readStudioAsset).toHaveBeenCalledWith({ assetId: 'asset-aio-report-2' }));
    await waitFor(() => expect(screen.getByLabelText('Source title')).toHaveValue('AI Overviews eat clicks — Comprehensive Trends Report'));
    expect(document.getElementById('cs-source-text').value).toContain('Original text.');
  });
});

describe('Opening a run shows that run', () => {
  it('Advanced Inbox › Research run stopped opens that run under its own program', async () => {
    await boot({ programs: [newest, older], researchRuns: [runOfNewest, failedOlder] }, { uiMode: 'classic' });
    side('inbox');
    fireEvent.click(await screen.findByRole('button', { name: /Research run stopped/ }));
    await h1('Research programs');
    await waitFor(() => expect(runShown()).toContain('Failed run of older'));
    expect(runShown()).not.toContain('Run of newest');
    expect(document.querySelector('.cs-research-main .cs-panel-title h3')?.textContent).toBe('Older program');
  });

  it('Advanced Inbox › Drafts stopped opens Create content with that run’s progress', async () => {
    const now = new Date().toISOString();
    await boot({ contentRuns: [{ id: 'c-fail', workspaceId: 'general', status: 'failed', title: 'Broken draft', message: 'Claude refused', createdAt: now, updatedAt: now, jobs: [{ id: 'bloglong', label: 'Blog', status: 'failed' }] }] }, { uiMode: 'classic' });
    side('inbox');
    fireEvent.click(await screen.findByRole('button', { name: /Drafts stopped/ }));
    await h1('Create content');
    await waitFor(() => expect(runShown()).toContain('Broken draft'));
  });

  it('the Working popover’s Open selects the live run, not the newest program’s run', async () => {
    const live = { id: 'r3', workspaceId: 'general', programId: 'p2', title: 'Live run of older', status: 'running', stage: 'collecting', createdAt: '2026-10-01T00:00:00Z' };
    await boot({ programs: [newest, older], researchRuns: [runOfNewest, live] }, { uiMode: 'classic' });
    fireEvent.click(document.querySelector('[data-spot="top.working"]'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Working now' })).getByRole('button', { name: 'Open Live run of older' }));
    await h1('Research programs');
    await waitFor(() => expect(runShown()).toContain('Live run of older'));
  });

  it('Simple Trends › See why on a stopped run opens that run in the Advanced peek', async () => {
    await boot({ programs: [newest, older], researchRuns: [runOfNewest, failedOlder] });
    side('trends');
    const stopped = await screen.findByText('Research stopped · Older program');
    fireEvent.click(within(stopped.closest('[role="status"]')).getByRole('button', { name: /See why/ }));
    await h1('Research programs');
    expect(mode()).toBe('classic');
    await waitFor(() => expect(runShown()).toContain('Failed run of older'));
    expect(runShown()).not.toContain('Run of newest');
  });

  it('a trends report being written opens its trend from Home’s Working now, not a blank Create content', async () => {
    const theme = { id: 't1', name: 'Answer engines', evidenceCount: 4 };
    await boot({ programs: [newest], researchRuns: [{ id: 'r-w', workspaceId: 'general', programId: 'p1', title: 'Weekly', status: 'running', stage: 'reports', createdAt: '2026-10-12T00:00:00Z', discoveredThemes: [theme], themes: [theme], decisions: { t1: 'approved' }, reportRunIds: [{ themeId: 't1', runId: 'c-rep' }] }],
      contentRuns: [{ id: 'c-rep', workspaceId: 'general', type: 'content', title: 'Answer engines report', themeId: 't1', researchRunId: 'r-w', status: 'running', stage: 'content', createdAt: '2026-10-12T01:00:00Z', jobs: [] }] });
    fireEvent.click(within(screen.getByRole('region', { name: /Working now/ })).getByRole('button', { name: 'Answer engines report' }));
    await waitFor(() => expect(document.querySelector('[data-spot="nav.trends"]')).toHaveAttribute('aria-current', 'page'));
    expect(mode()).toBe('simple');
    expect(screen.queryByRole('heading', { level: 1, name: 'Create content' })).not.toBeInTheDocument();
  });
});

describe('Advanced navigation asks about unsaved edits once', () => {
  async function editReport() {
    openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: 'Read: AI Overviews eat clicks' } });
    fireEvent.keyDown(within(palette).getByRole('textbox', { name: 'Search commands' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Text of / }), { target: { value: 'Half-written edit' } });
  }

  it('the sidebar and the Library’s own Create content ask first, and Stay keeps the editor', async () => {
    await editReport();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^Trend board/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Leave without saving your edits?');
    expect(screen.getByRole('heading', { level: 1, name: 'Your asset library' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Text of / })).toHaveValue('Half-written edit');
    // The palette's Read of another report replaces the editor, so it asks too.
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.change(within(palette).getByRole('textbox', { name: 'Search commands' }), { target: { value: 'Read: Local packs shrink' } });
    fireEvent.keyDown(within(palette).getByRole('textbox', { name: 'Search commands' }), { key: 'Enter' });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: /^Text of / })).toHaveValue('Half-written edit');
  });

  it('Settings asks exactly once, and Leave goes', async () => {
    await editReport();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe('Requests are spent once their page is left', () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-handoffs-'));
  afterAll(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
  const store = teamStoreModule.createTeamStore({ root: storeRoot });
  const ACCESS = store.accessSummary();
  const policy = store.accessPolicy();
  const member = { id: 'm-chris', name: 'Chris DiMarco', email: 'chris@semrush.com', role: 'admin', channelId: null, disabled: false, createdAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '', serverAdmin: false, link: null, grants: [], denies: [], roleLabel: 'Admin', base: 'admin', capabilities: roles.capabilitiesFor({ roleId: 'admin', grants: [], denies: [] }, policy) };

  it('New › Person opens Invite once; People & access later opens the list', async () => {
    const team = { members: [member], channels: [{ id: 'blog', name: 'Semrush Blog', short: 'Blog', owners: [] }], signIn: { web: true, sso: false, links: true, linkDays: 30 }, access: ACCESS };
    openStudio('admin', { uiMode: 'classic', web: true, api: { getTeam: vi.fn(async () => team), inviteMembers: vi.fn(async () => ({ members: [], links: [], skipped: [] })), saveMember: vi.fn(), readAccessLog: vi.fn(async () => ({ rows: [], more: false })) } });
    await h1(GREETING.name);
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Person/ }));
    const invite = await screen.findByRole('dialog', { name: 'Invite people' });
    fireEvent.click(within(invite).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invite people' })).not.toBeInTheDocument());
    side('board');
    await h1('Trend board');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^People & access/ }));
    await h1('People & access');
    await screen.findByText('Chris DiMarco', { selector: 'strong' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog', { name: 'Invite people' })).not.toBeInTheDocument();
  });

  it('Sheets opened for one run, then left, opens a newer run on the next plain visit', async () => {
    const workbook = (id) => ({ id, name: id, kind: 'research', status: 'succeeded', edits: { version: 1, sheets: {} }, sheets: [{ id: 'x', name: 'Twitter', columns: ['post_text'], rows: [['A post']], rowKeys: ['e1'] }] });
    const listing = (id, createdAt) => ({ id, kind: 'research', programId: 'p1', name: id, createdAt, updatedAt: createdAt, status: 'succeeded', rowCount: 1 });
    const listWorkbooks = vi.fn(async () => [listing('r1', '2026-10-11T00:00:00Z')]);
    const readWorkbook = vi.fn(async ({ workbookId }) => workbook(workbookId));
    window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    await boot({ programs: [newest], researchRuns: [{ ...runOfNewest, counts: { retained: 5 } }] }, { uiMode: 'classic', edition: 'semrush', api: { listWorkbooks, readWorkbook, saveWorkbookEdits: vi.fn(async () => ({})), readDataset: vi.fn(async () => ({ items: [] })) } });
    side('research');
    fireEvent.click(await screen.findByRole('button', { name: /Open in Sheets/ }));
    await waitFor(() => expect(readWorkbook).toHaveBeenCalledWith({ workbookId: 'r1' }));
    side('library');
    await h1('Your asset library');
    // A research run started meanwhile: a plain visit to Sheets opens it, as Sheets does for new runs.
    listWorkbooks.mockResolvedValue([listing('r1', '2026-10-11T00:00:00Z'), listing('r9', '2026-10-13T00:00:00Z')]);
    side('sheets');
    await waitFor(() => expect(readWorkbook).toHaveBeenCalledWith({ workbookId: 'r9' }));
  });

  it('⌘K reads People again each time it opens', async () => {
    const { api } = openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByRole('dialog', { name: 'Command palette' });
    await waitFor(() => expect(api.getTeam).toHaveBeenCalled());
    const before = api.getTeam.mock.calls.length;
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByRole('dialog', { name: 'Command palette' });
    await waitFor(() => expect(api.getTeam.mock.calls.length).toBe(before + 1));
  });
});

describe('Links and openers land on what they name', () => {
  it('New › Content from a report opens Create content on Use a report', async () => {
    openStudio('admin', { uiMode: 'classic', api: { createContentRun: vi.fn() } });
    await h1(GREETING.name);
    fireEvent.click(document.querySelector('[data-spot="nav.new"]'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Content from a report/ }));
    await h1('Create content');
    expect(screen.getByRole('button', { name: /Use a report/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the Working popover’s Open on a live channel-asset set opens its folder in the Library', async () => {
    openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    fireEvent.click(document.querySelector('[data-spot="top.working"]'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Working now' })).getByRole('button', { name: 'Open Local packs shrink' }));
    await h1('Your asset library');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Folder path' })).toHaveTextContent('Local packs shrink'));
  });

  it('Needs your OK on a recurring trend opens its card waiting for an OK, not last run’s report', async () => {
    const { api } = openStudio('admin');
    await h1(GREETING.name);
    fireEvent.click(within(screen.getByRole('region', { name: /Needs your OK/ })).getByRole('button', { name: 'AI Overviews eat clicks' }));
    await waitFor(() => expect(document.querySelector('[data-spot="nav.trends"]')).toHaveAttribute('aria-current', 'page'));
    expect(api.readStudioAsset).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('[data-spot="trends.card"]')].some((node) => node.dataset.spotItem === 'AI Overviews eat clicks')).toBe(true);
  });

  it('a quick scan’s trend link opens the Trend tracker and says why', async () => {
    window.history.replaceState(null, '', '/#/trend/qs-theme');
    const readWorkbook = vi.fn(async ({ workbookId }) => ({ id: workbookId, name: 'Trend tracker', kind: 'tracker', edits: { version: 1, sheets: {} }, sheets: [{ id: 'trends', name: 'Trends', columns: ['Trend'], rows: [['Answer engines']], rowKeys: ['t'] }] }));
    window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    await boot({ programs: [newest], researchRuns: [runOfNewest, { id: 'qs', workspaceId: 'general', programId: 'p1', origin: 'quick-scan', title: 'Quick scan · answer engines', status: 'succeeded', createdAt: '2026-10-13T00:00:00Z', discoveredThemes: [{ id: 'qs-theme', name: 'Answer engines' }], themes: [{ id: 'qs-theme', name: 'Answer engines' }] }] },
      { wait: false, api: { listWorkbooks: vi.fn(async () => [{ id: 'trend-tracker', kind: 'tracker', name: 'Trend tracker', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', rowCount: 1 }]), readWorkbook, saveWorkbookEdits: vi.fn(async () => ({})) } });
    await waitFor(() => expect(readWorkbook).toHaveBeenCalledWith({ workbookId: 'trend-tracker' }));
    expect(await screen.findByText('“Answer engines” came from a quick scan, so it’s in the Trend tracker, not on Trends.')).toBeInTheDocument();
  });

  it('a channel owner opening a report link gets that trend’s brief', async () => {
    window.history.replaceState(null, '', '/#/report/asset-aio-report-2');
    openStudio('channel');
    expect(await screen.findByRole('dialog', { name: 'AI Overviews eat clicks' })).toBeInTheDocument();
    expect(screen.queryByText('Reports open from a trend’s brief on Trends.')).not.toBeInTheDocument();
  });

  it('a channel owner opening an Assets folder link lands on that trend’s set', async () => {
    window.history.replaceState(null, '', '/#/assets/theme:theme-aio');
    openStudio('channel');
    const group = await screen.findByRole('heading', { level: 2, name: 'AI Overviews eat clicks' });
    await waitFor(() => expect(group).toHaveFocus());
  });

  it('Back to Admin after a preview returns to People & access', async () => {
    const { api } = openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /^People & access/ }));
    await h1('People & access');
    fireEvent.click(await screen.findByRole('button', { name: 'Preview as an editor' }));
    await screen.findByText(/^Previewing what an editor sees/);
    await waitFor(() => expect(screen.queryAllByRole('heading', { level: 1, name: 'People & access' })).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Admin' }));
    await waitFor(() => expect(api.setViewAs).toHaveBeenLastCalledWith({ role: 'admin' }));
    expect(await h1('People & access')).toBeInTheDocument();
  });

  it('Back to Admin leaves the admin where they went when the preview could show the page it started on', async () => {
    const { api } = openStudio('admin', { uiMode: 'classic' });
    await h1(GREETING.name);
    side('board');
    await h1('Trend board');
    fireEvent.click(screen.getByRole('button', { name: /^Account: Chris/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Editor' }));
    await screen.findByText(/^Previewing what an editor sees/);
    side('library');
    await h1('Your asset library');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Admin' }));
    await waitFor(() => expect(api.setViewAs).toHaveBeenLastCalledWith({ role: 'admin' }));
    await waitFor(() => expect(screen.queryByText(/^Previewing what/)).not.toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 1, name: 'Your asset library' }).length).toBeGreaterThan(0);
  });
});
