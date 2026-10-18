import { describe, expect, it } from 'vitest';
import { DATA_TOOL_IDS, PAGE_LABELS, ariaKeys, buildNav, findNavItem, focusChannelOptions, generalStudioTabs, isChannelViewer, isRealAdmin, itemName, navPages, viewAsChoice, viewAsOptions } from '../src/renderer/src/nav-model.js';

const channels = [{ id: 'blog', name: 'Semrush Blog', short: 'Blog' }, { id: 'social', name: 'Semrush Social Team', short: 'Social' }];
const admin = (over = {}) => ({ id: 'local', name: 'Alex Rivera', role: 'admin', realRole: 'admin', preview: false, modes: ['simple', 'classic'], channels, prefs: {}, allowed: null, ...over });
const editor = (over = {}) => ({ id: 'm-riley', name: 'Riley Jones', role: 'editor', realRole: 'editor', preview: false, modes: ['simple', 'classic'], hiddenPages: ['settings', 'knowledge', 'analytics', 'people'], nav: { main: ['home', 'reports', 'trends', 'assets', 'ask'], admin: ['prompts'], bottom: [] },
  allowed: ['askHelp', 'startResearchRun', 'startQuickScan', 'planAssetKit', 'createAssetKit', 'createContentRun', 'createHelpImage', 'listPrompts', 'decideResearchTheme', 'setViewPrefs'], ...over });
const owner = { id: 'm-sam', name: 'Sam Lee', role: 'channel', realRole: 'channel', channelId: 'blog', channelName: 'Semrush Blog', modes: ['simple'], allowed: ['setViewPrefs', 'createAssetKit', 'planAssetKit'] };
const studio = (over = {}) => ({
  activeWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'Semrush workspace', editionId: 'semrush' }],
  programs: [{ id: 'p1', name: 'SEO weekly', workspaceId: 'w1' }], researchRuns: [], contentRuns: [], ...over,
});
const state = (over = {}, keys = { APIFY_API_TOKEN: true, OPENAI_API_KEY: true }) => ({ keys, contentStudio: studio(over) });
const labels = (model) => model.groups.map((group) => [group.id, group.items.map((row) => row.label)]);
const ids = (rows) => rows.map((row) => row.id);

describe('buildNav: Simple', () => {
  it('lists the work in order, then the Studio group, and numbers ⌘1–9 in that order (Settings keeps ⌘,)', () => {
    const nav = buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' });
    expect(labels(nav)).toEqual([['work', ['Home', 'Trends', 'Reports', 'Assets', 'Inbox', 'Calendar']], ['studio', ['Prompts', 'Analytics', 'People & access', 'Settings']]]);
    expect(nav.groups.map((group) => group.label)).toEqual(['', 'Studio']);
    expect(nav.order.map((row) => `${row.id} ${row.shortcut}`)).toEqual(['home ⌘1', 'trends ⌘2', 'reports ⌘3', 'assets ⌘4', 'inbox ⌘5', 'calendar ⌘6', 'prompts ⌘7', 'analytics ⌘8', 'people ⌘9']);
    expect(findNavItem(nav, 'settings')).toMatchObject({ kind: 'settings', shortcut: '⌘,', spot: 'nav.settings' });
    expect(findNavItem(nav, 'trends')).toMatchObject({ kind: 'simple', target: 'trends', spot: 'nav.trends', icon: 'TrendingUp' });
    expect(nav.actions.ask).toMatchObject({ mode: 'page', shortcut: '⌘J', spot: 'nav.ask' });
    expect(nav.actions.search).toMatchObject({ shortcut: '⌘K', spot: 'nav.find' });
    expect(nav.footer.layouts.map((row) => row.label)).toEqual(['Simple', 'Advanced']);
  });

  it('counts only work waiting on this person, marks live work with a dot, and says both in words', () => {
    const running = state({ researchRuns: [{ id: 'r1', status: 'running', workspaceId: 'w1' }], contentRuns: [{ id: 'k1', status: 'queued', kit: { sourceKey: 'a' }, workspaceId: 'w1' }] }, { APIFY_API_TOKEN: false });
    const nav = buildNav({ viewer: admin(), layout: 'simple', state: running, counts: { waiting: 3 }, inboxUnread: 2, edition: 'semrush' });
    const named = navPages(nav).filter((row) => row.badge || row.live || row.warn).map(itemName);
    expect(named).toEqual(['Trends, 3 need your OK', 'Assets, channel assets being made', 'Inbox, 2 unread', 'Settings, Apify isn’t connected']);
    expect(findNavItem(nav, 'trends')).toMatchObject({ badge: 3, live: true });
    expect(itemName({ label: 'Trends', badge: 1, badgeLabel: '1 needs your OK' })).toBe('Trends, 1 needs your OK');
    // Runs in another workspace aren't this person's live work.
    const elsewhere = buildNav({ viewer: admin(), layout: 'simple', state: state({ researchRuns: [{ id: 'r2', status: 'running', workspaceId: 'w2' }] }), edition: 'semrush' });
    expect(findNavItem(elsewhere, 'trends').live).toBe(false);
  });

  it('gives an editor the pages their nav lists, no admin pages, and Prompts when policy grants it', () => {
    const nav = buildNav({ viewer: editor(), layout: 'simple', state: state(), edition: 'semrush' });
    expect(labels(nav)).toEqual([['work', ['Home', 'Trends', 'Reports', 'Assets']], ['studio', ['Prompts']]]);
    expect(nav.order.map((row) => row.shortcut)).toEqual(['⌘1', '⌘2', '⌘3', '⌘4', '⌘5']);
    expect(ids(nav.actions.create)).toEqual(['research', 'quick-scan', 'assets', 'content', 'picture']);
    expect(nav.shortcuts.map((row) => row.keys)).not.toContain('⌘,');
    // Inbox and Calendar show once the role's nav lists them.
    const listed = buildNav({ viewer: editor({ nav: { main: ['home', 'trends', 'reports', 'assets', 'inbox', 'calendar', 'ask'], admin: [] } }), layout: 'simple', state: state(), edition: 'semrush' });
    expect(labels(listed)[0][1]).toEqual(['Home', 'Trends', 'Reports', 'Assets', 'Inbox', 'Calendar']);
    expect(listed.groups.some((group) => group.id === 'studio')).toBe(false);
  });

  it('drops Ask AI when the role can’t ask, and the Studio pages the studio doesn’t offer', () => {
    const nav = buildNav({ viewer: editor({ allowed: ['setViewPrefs'] }), layout: 'simple', state: state(), edition: 'semrush' });
    expect(nav.actions.ask).toBeNull();
    expect(nav.actions.create).toEqual([]);
    const missing = buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush', can: (method) => method !== 'listPrompts' });
    expect(ids(navPages(missing))).not.toContain('prompts');
  });
});

describe('buildNav: Advanced', () => {
  it('has Research, Content, a collapsible Data tools group and Studio for the Semrush edition', () => {
    const nav = buildNav({ viewer: admin(), layout: 'classic', state: state(), edition: 'semrush', counts: { waiting: 2 }, dataToolsOpen: false });
    expect(labels(nav)).toEqual([
      ['research', ['Home', 'Inbox', 'Research programs', 'Trend board', 'Sheets']],
      ['content', ['Create content', 'Library', 'Calendar', 'Brand knowledge']],
      ['automate', ['Playbooks', 'Workflows']],
      ['data', ['Search platforms', 'Scrapers', 'Import research', 'Brief starters', 'Datasets', 'Dataset reports', 'Compare snapshots', 'Ask your datasets', 'Activity']],
      ['studio', ['Prompts', 'Analytics', 'People & access', 'Settings']],
    ]);
    const data = nav.groups.find((group) => group.id === 'data');
    expect(data).toMatchObject({ label: 'Data tools', collapsible: true, open: false, spot: 'nav.data-tools' });
    expect(data.subgroups.map((sub) => [sub.label, sub.items.length])).toEqual([['Collect', 4], ['Analyze', 4], ['', 1]]);
    // Data tools and Studio pages take no number here: Research and Content use all nine.
    expect(nav.order.map((row) => row.id)).toEqual(['overview', 'inbox', 'research', 'board', 'sheets', 'create', 'library', 'calendar', 'knowledge']);
    expect(findNavItem(nav, 'board')).toMatchObject({ badge: 2, badgeLabel: '2 need your OK', kind: 'studio' });
    expect(findNavItem(nav, 'sheets')).toMatchObject({ kind: 'app', target: 'sheets' });
    expect(findNavItem(nav, 'reports')).toMatchObject({ label: 'Dataset reports', spot: 'nav.dataset-reports' });
    expect(nav.actions.ask.mode).toBe('drawer');
    expect(buildNav({ viewer: admin(), layout: 'classic', state: state(), edition: 'semrush', dataToolsOpen: true }).groups.find((group) => group.id === 'data').open).toBe(true);
  });

  it('gives the General edition one Workspace group, and the palette its content-studio tabs', () => {
    const nav = buildNav({ viewer: admin(), layout: 'classic', state: state(), edition: 'general' });
    expect(labels(nav)[0]).toEqual(['workspace', ['Content studio', 'Overview', 'Sheets', 'Inbox', 'Calendar']]);
    expect(ids(generalStudioTabs({ viewer: editor() }))).toEqual(['research', 'board', 'create', 'library']);
    expect(generalStudioTabs({ viewer: admin(), hasStudio: false })).toEqual([]);
  });

  it('hides pages the role can’t open and the whole Data tools group when its capability is off', () => {
    const hidden = buildNav({ viewer: editor(), layout: 'classic', state: state(), edition: 'semrush' });
    expect(ids(navPages(hidden))).not.toContain('knowledge');
    expect(ids(navPages(hidden))).not.toContain('inbox');
    expect(hidden.groups.some((group) => group.id === 'data')).toBe(true);
    const viewerRole = editor({ capabilities: ['core', 'readAssets', 'readResearch'] });
    expect(buildNav({ viewer: viewerRole, layout: 'classic', state: state(), edition: 'semrush' }).groups.some((group) => group.id === 'data')).toBe(false);
    expect(buildNav({ viewer: editor({ hiddenPages: ['data-tools'] }), layout: 'classic', state: state(), edition: 'semrush' }).groups.some((group) => group.id === 'data')).toBe(false);
    // Without the content studio there are no Research or Content groups to show.
    expect(buildNav({ viewer: admin(), layout: 'classic', state: state(), edition: 'semrush', hasStudio: false }).groups[0].id).toBe('workspace');
  });
});

describe('buildNav: channel owners', () => {
  it('shows Trends, My assets and My plan, with new trends counted, and nothing to create, search or ask', () => {
    const nav = buildNav({ viewer: owner, layout: 'channel', state: { contentStudio: { channelView: { counts: { newTrends: 4 } } } }, edition: 'semrush' });
    expect(labels(nav)).toEqual([['channel', ['Trends', 'My assets', 'My plan']]]);
    expect(itemName(findNavItem(nav, 'trends'))).toBe('Trends, 4 new');
    expect(nav.order.map((row) => row.shortcut)).toEqual(['⌘1', '⌘2', '⌘3']);
    expect(nav.actions).toEqual({ create: [], search: null, ask: null });
    expect(nav.footer).toMatchObject({ layouts: [], viewAs: [], channels: [] });
    // A role whose nav lists only the two built-in tabs doesn't get My plan; one that lists Inbox gets it.
    const listed = buildNav({ viewer: { ...owner, nav: { main: ['trends', 'assets', 'inbox'] } }, layout: 'channel', state: {}, edition: 'semrush', inboxUnread: 1 });
    expect(labels(listed)[0][1]).toEqual(['Trends', 'My assets', 'Inbox']);
    expect(isChannelViewer({ role: 'role-reviewer-1a2b', base: 'channel' })).toBe(true);
    expect(isChannelViewer(editor())).toBe(false);
  });
});

describe('buildNav: New', () => {
  it('offers every kind of new thing, with the admin rows last, and lists programs when there are several', () => {
    const nav = buildNav({ viewer: admin({ web: true }), layout: 'simple', state: state({ programs: [{ id: 'p1', name: 'SEO weekly', workspaceId: 'w1' }, { id: 'p2', name: 'AI search', workspaceId: 'w1' }, { id: 'p3', name: 'Elsewhere', workspaceId: 'w2' }] }), edition: 'semrush' });
    expect(nav.actions.create.map((row) => `${row.id}:${row.section}`)).toEqual(['research:main', 'quick-scan:main', 'assets:main', 'content:main', 'picture:main', 'program:admin', 'playbook:admin', 'person:admin', 'workspace:admin']);
    // People on the Mac has no invite, so New › Person is the browser studio's only.
    expect(ids(buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' }).actions.create)).not.toContain('person');
    // A one-workspace build offers no New › Workspace.
    expect(ids(buildNav({ viewer: admin(), layout: 'simple', state: state({ workspacePolicy: { mode: 'single', name: 'Main' } }), edition: 'semrush' }).actions.create)).not.toContain('workspace');
    expect(nav.actions.create[0].choices).toEqual([{ id: 'p1', label: 'SEO weekly' }, { id: 'p2', label: 'AI search' }]);
    const one = buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' });
    expect(one.actions.create[0]).toMatchObject({ choices: [], programId: 'p1', hint: 'Runs a research program. You’ll see the cost first.' });
    const none = buildNav({ viewer: admin(), layout: 'simple', state: state({ programs: [] }), edition: 'semrush' });
    expect(none.actions.create[0].hint).toBe('Set up a research program first.');
  });

  it('turns pictures into a Settings errand for admins and an explanation for editors when they are off', () => {
    const off = state({}, { APIFY_API_TOKEN: true, OPENAI_API_KEY: false });
    expect(buildNav({ viewer: admin(), layout: 'simple', state: off, edition: 'semrush' }).actions.create.find((row) => row.id === 'picture')).toMatchObject({ disabled: false, hint: 'Pictures are off. Turn them on in Settings.' });
    expect(buildNav({ viewer: editor(), layout: 'simple', state: off, edition: 'semrush' }).actions.create.find((row) => row.id === 'picture')).toMatchObject({ disabled: true, hint: 'Ask an admin to turn on pictures.' });
  });

  it('turns the admin rows off while previewing', () => {
    const nav = buildNav({ viewer: admin({ preview: true }), layout: 'simple', state: state(), edition: 'semrush' });
    const rows = nav.actions.create.filter((row) => row.section === 'admin');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.disabled && row.title === 'Buttons that change things are off in a preview.')).toBe(true);
  });
});

describe('View as and My channels', () => {
  it('lists Admin, Editor, custom roles and each channel, and finds the one being previewed', () => {
    const viewer = admin({ roles: [{ id: 'admin', label: 'Admin', base: 'admin' }, { id: 'editor', label: 'Editor', base: 'editor' }, { id: 'role-viewer-ab12', label: 'Viewer', base: 'editor' }, { id: 'role-reviewer-cd34', label: 'Channel reviewer', base: 'channel' }] });
    const options = viewAsOptions(viewer);
    expect(options.map((row) => row.label)).toEqual(['Admin (you)', 'Editor', 'Viewer', 'Channel reviewer · Blog', 'Semrush Blog', 'Semrush Social Team']);
    expect(options.find((row) => row.value === 'role:role-reviewer-cd34').payload).toEqual({ role: 'role-reviewer-cd34', channelId: 'blog' });
    expect(viewAsChoice(viewer, options)).toBe('admin');
    expect(viewAsChoice({ ...viewer, preview: true, role: 'channel', channelId: 'social', viewAs: { role: 'channel', channelId: 'social' } }, options)).toBe('channel:social');
    expect(viewAsChoice({ ...viewer, preview: true, role: 'role-viewer-ab12', viewAs: { role: 'role-viewer-ab12' } }, options)).toBe('role:role-viewer-ab12');
    const person = { ...viewer, preview: true, role: 'editor', previewName: 'Jordan Park', viewAs: { memberId: 'm-jordan', role: 'editor' } };
    expect(viewAsOptions(person).at(-1)).toMatchObject({ value: 'member:m-jordan', label: 'Jordan Park' });
    expect(viewAsChoice(person)).toBe('member:m-jordan');
    expect(viewAsOptions(editor())).toEqual([]);
    expect(isRealAdmin({ role: 'editor', realRole: 'admin', preview: true })).toBe(true);
  });

  it('offers the admin’s channel list, or the edition’s kit folders to everyone else', () => {
    expect(focusChannelOptions(admin(), 'semrush').map((row) => row.id)).toEqual(['blog', 'social']);
    const semrush = focusChannelOptions({}, 'semrush');
    expect(semrush[0]).toEqual({ id: 'blog', name: 'Semrush Blog', short: 'Blog' });
    expect(focusChannelOptions({}, 'general')[0]).toEqual({ id: 'blog', name: 'Blog', short: 'Blog' });
    expect(buildNav({ viewer: editor(), layout: 'simple', state: state(), edition: 'semrush' }).footer.channels.length).toBe(semrush.length);
  });
});

describe('labels and keys', () => {
  it('names pages for the breadcrumb and spells shortcuts for aria-keyshortcuts', () => {
    expect(PAGE_LABELS).toMatchObject({ overview: 'Home', dashboard: 'Overview', reports: 'Dataset reports', people: 'People & access', settings: 'Settings', inbox: 'Inbox' });
    expect(DATA_TOOL_IDS).toEqual(['search', 'automation', 'imports', 'templates', 'datasets', 'reports', 'compare', 'chat', 'runs']);
    expect(ariaKeys('⌘1')).toBe('Meta+1');
    expect(ariaKeys('⌥⌘N')).toBe('Alt+Meta+N');
    const nav = buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' });
    expect(nav.shortcuts.slice(0, 2)).toEqual([{ keys: '⌘1', label: 'Home' }, { keys: '⌘2', label: 'Trends' }]);
    expect(nav.shortcuts.map((row) => row.keys).slice(-6)).toEqual(['⌘K', '⌘J', '⌥⌘N', '⌘,', '⌘\\', 'Esc']);
  });
});

describe('buildNav: Automate', () => {
  it('puts Playbooks and Workflows in Advanced for admins and editors, with what waits on them', () => {
    const nav = buildNav({ viewer: admin(), layout: 'classic', state: state({ workflowSummary: { waiting: 2 }, workflows: [{ id: 'workflow-a', running: true }] }), edition: 'semrush' });
    expect(nav.groups.map((group) => group.id)).toEqual(['research', 'content', 'automate', 'data', 'studio']);
    expect(findNavItem(nav, 'workflows')).toMatchObject({ badge: 2, badgeLabel: '2 waiting on you', live: true, liveLabel: 'a workflow is running', spot: 'nav.workflows', kind: 'app' });
    expect(findNavItem(nav, 'templates')).toMatchObject({ label: 'Brief starters', spot: 'nav.brief-starters' });
    const general = buildNav({ viewer: admin(), layout: 'classic', state: state(), edition: 'general' });
    expect(general.groups.map((group) => group.id).slice(0, 2)).toEqual(['workspace', 'automate']);
    const reader = editor({ allowed: [...editor().allowed, 'estimateWorkflow'] });
    expect(ids(buildNav({ viewer: reader, layout: 'classic', state: state(), edition: 'semrush' }).groups.find((group) => group.id === 'automate').items)).toEqual(['playbooks', 'workflows']);
  });
  it('leaves Automate out without readWorkflows, and Simple stays at its pages', () => {
    const viewer = editor({ hiddenPages: ['settings', 'knowledge', 'analytics', 'people', 'playbooks', 'workflows'] });
    expect(buildNav({ viewer, layout: 'classic', state: state(), edition: 'semrush' }).groups.some((group) => group.id === 'automate')).toBe(false);
    expect(buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' }).groups[0].items.map((row) => row.id)).not.toContain('workflows');
  });
  it('offers New › Playbook only to someone who can set one up', () => {
    expect(ids(buildNav({ viewer: admin(), layout: 'simple', state: state(), edition: 'semrush' }).actions.create)).toContain('playbook');
    expect(ids(buildNav({ viewer: editor(), layout: 'simple', state: state(), edition: 'semrush' }).actions.create)).not.toContain('playbook');
  });
});
