// The left navigation as data, for every layout and role. Pure and renderer-side (ESM, no React): the sidebar draws it,
// the ⌘K palette lists its pages under the same names, and App's one ⌘1–9 handler walks `order`, so the three never
// drift. Icons are lucide component names (studio-sidebar.jsx maps them). The server decides access; this only hides.
//
// buildNav({ viewer, layout, state, counts, edition, inboxUnread, can, hasStudio, dataToolsOpen }) →
//   { layout, groups:[{ id, label, collapsible, open, items:[Item], subgroups?:[{ id, label, items }] }],
//     actions:{ create:[CreateItem], search, ask }, footer:{ layouts, viewAs, channels }, order:[Item], shortcuts }
//   Item = { id, label, icon, shortcut, badge, badgeLabel, live, liveLabel, warn, warnLabel, spot, kind, target }
//   kind: 'simple' (a Simple tab) · 'studio' (an Advanced studio view) · 'app' (an Advanced app page) · 'admin' (a Studio
//   page in either layout) · 'settings' · 'channel' (a channel owner's tab). `target` is the id that kind opens.
import KIT from '../../shared/kit-folders.json';

const list = (value) => (Array.isArray(value) ? value : []);
const ACTIVE = new Set(['queued', 'running']);
const PREVIEW_TITLE = 'Buttons that change things are off in a preview.'; // viewer.js says the same; kept here so this stays pure

// Simple: the work, in the order it happens (find, decide, read, make), then the person's own feed and plan.
export const SIMPLE_PAGES = Object.freeze([
  { id: 'home', label: 'Home', icon: 'House' },
  { id: 'trends', label: 'Trends', icon: 'TrendingUp' },
  { id: 'reports', label: 'Reports', icon: 'FileText' },
  { id: 'assets', label: 'Assets', icon: 'Images' },
  { id: 'inbox', label: 'Inbox', icon: 'Inbox' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarDays' },
]);
// Advanced, Semrush edition: Research and Content. Studio views open inside the content studio; Sheets, Inbox and
// Calendar are app pages.
export const RESEARCH_PAGES = Object.freeze([
  { id: 'overview', label: 'Home', icon: 'House', kind: 'studio' },
  { id: 'inbox', label: 'Inbox', icon: 'Inbox', kind: 'app' },
  { id: 'research', label: 'Research programs', icon: 'Radar', kind: 'studio' },
  { id: 'board', label: 'Trend board', icon: 'SquareKanban', kind: 'studio' },
  { id: 'sheets', label: 'Sheets', icon: 'Sheet', kind: 'app' },
]);
export const CONTENT_PAGES = Object.freeze([
  { id: 'create', label: 'Create content', icon: 'SquarePen', kind: 'studio' },
  { id: 'library', label: 'Library', icon: 'Library', kind: 'studio' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', kind: 'app' },
  { id: 'knowledge', label: 'Brand knowledge', icon: 'BookOpen', kind: 'studio' },
]);
// Advanced, General edition: the content studio is one page with its own tabs.
export const WORKSPACE_PAGES = Object.freeze([
  { id: 'content-studio', label: 'Content studio', icon: 'Layers', kind: 'app' },
  { id: 'dashboard', label: 'Overview', icon: 'Gauge', kind: 'app' },
  { id: 'sheets', label: 'Sheets', icon: 'Sheet', kind: 'app' },
  { id: 'inbox', label: 'Inbox', icon: 'Inbox', kind: 'app' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', kind: 'app' },
]);
// The General edition's content studio tabs: not in its sidebar, but the palette finds them.
const GENERAL_STUDIO_TABS = Object.freeze([
  { id: 'research', label: 'Research programs', icon: 'Radar' },
  { id: 'board', label: 'Trend board', icon: 'SquareKanban' },
  { id: 'create', label: 'Create content', icon: 'SquarePen' },
  { id: 'library', label: 'Library', icon: 'Library' },
  { id: 'knowledge', label: 'Brand knowledge', icon: 'BookOpen' },
]);
// Data tools: three labelled sets, then Activity on its own. Ids are App's page ids; spots keep their old names.
export const DATA_TOOLS = Object.freeze([
  { id: 'collect', label: 'Collect', items: [{ id: 'search', label: 'Search platforms', icon: 'ScanSearch', spot: 'nav.search' }, { id: 'automation', label: 'Scrapers', icon: 'Globe', spot: 'nav.scrapers' }, { id: 'imports', label: 'Import research', icon: 'FileUp', spot: 'nav.imports' }, { id: 'templates', label: 'Brief starters', icon: 'FileStack', spot: 'nav.brief-starters' }] },
  { id: 'analyze', label: 'Analyze', items: [{ id: 'datasets', label: 'Datasets', icon: 'Database', spot: 'nav.datasets' }, { id: 'reports', label: 'Dataset reports', icon: 'FileChartColumn', spot: 'nav.dataset-reports' }, { id: 'compare', label: 'Compare snapshots', icon: 'GitCompareArrows', spot: 'nav.compare' }, { id: 'chat', label: 'Ask your datasets', icon: 'MessagesSquare', spot: 'nav.ask-datasets' }] },
  { id: 'activity', label: '', items: [{ id: 'runs', label: 'Activity', icon: 'Activity', spot: 'nav.activity' }] },
]);
export const DATA_TOOL_IDS = Object.freeze(DATA_TOOLS.flatMap((set) => set.items.map((item) => item.id)));
// Automate (Advanced, after Content or Workspace): playbooks set up workflows; workflows run on their own inside an
// approved budget. Shown when the person may read workflows (readWorkflows) and the page isn't hidden.
export const AUTOMATE_PAGES = Object.freeze([
  { id: 'playbooks', label: 'Playbooks', icon: 'LayoutGrid', kind: 'app', spot: 'nav.playbooks', method: 'estimateWorkflow' },
  { id: 'workflows', label: 'Workflows', icon: 'Workflow', kind: 'app', spot: 'nav.workflows', method: 'estimateWorkflow' },
]);
// The Studio group, in both layouts. Each page shows when the person may call its method.
export const STUDIO_PAGES = Object.freeze([
  { id: 'prompts', label: 'Prompts', icon: 'ScrollText', method: 'listPrompts' },
  { id: 'analytics', label: 'Analytics', icon: 'ChartColumn', method: 'getTrendAnalytics' },
  { id: 'people', label: 'People & access', icon: 'Users', method: 'getTeam' },
]);
export const CHANNEL_PAGES = Object.freeze([
  { id: 'trends', label: 'Trends', icon: 'TrendingUp' },
  { id: 'assets', label: 'My assets', icon: 'FolderOpen' },
  { id: 'plan', label: 'My plan', icon: 'CalendarDays' },
  { id: 'inbox', label: 'Inbox', icon: 'Inbox' },
]);
// Page titles by id, for the Advanced breadcrumb and the small-screen top bar.
export const PAGE_LABELS = Object.freeze(Object.fromEntries([
  ...WORKSPACE_PAGES, ...RESEARCH_PAGES, ...CONTENT_PAGES, ...DATA_TOOLS.flatMap((set) => set.items), ...AUTOMATE_PAGES, ...STUDIO_PAGES,
  { id: 'settings', label: 'Settings' }, { id: 'ask', label: 'Ask AI' }, { id: 'marketing-template', label: 'Brief starters' },
].map((page) => [page.id, page.label])));

// Every keyboard shortcut outside the page numbers, for the Keyboard shortcuts dialog. `when` names what it needs.
export const GLOBAL_SHORTCUTS = Object.freeze([
  { keys: '⌘K', label: 'Search reports, trends and pages', when: 'search' },
  { keys: '⌘J', label: 'Ask AI', when: 'ask' },
  { keys: '⌥⌘N', label: 'New', when: 'create' },
  { keys: '⌘,', label: 'Settings', when: 'settings' },
  { keys: '⌘\\', label: 'Collapse or expand the sidebar', when: 'rail' },
  { keys: 'Esc', label: 'Close the open menu, dialog or search', when: '' },
]);
const KEY_NAMES = { '⌘': 'Meta', '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Control' };
// "⌘1" → "Meta+1", "⌥⌘N" → "Alt+Meta+N", for aria-keyshortcuts.
export const ariaKeys = (shortcut) => [...String(shortcut || '')].map((key) => KEY_NAMES[key] || key).join('+').replace(/\+{2,}/g, '+');

const LAYOUTS = Object.freeze([
  { id: 'simple', label: 'Simple', hint: 'The essentials: Home, Trends, Reports, Assets and Ask AI.' },
  { id: 'classic', label: 'Advanced', hint: 'Every tool, including research programs, sheets and scrapers.' },
]);
const BUILT_IN = new Set(['admin', 'editor', 'channel']);

// The viewer's own method check: viewer.allowed (in a preview, the previewed role's controls). null allows everything.
const viewerCan = (viewer) => (method) => !viewer?.allowed || (Array.isArray(viewer.roleAllowed) ? viewer.roleAllowed : viewer.allowed).includes(method);

// A channel-base role gets the channel shell, whatever its id (custom roles carry `base`).
export const isChannelViewer = (viewer) => (viewer?.base ? viewer.base === 'channel' : viewer?.role === 'channel');
export const isRealAdmin = (viewer) => (viewer?.realBase || viewer?.realRole || viewer?.role) === 'admin';

// View as, for real admins: Admin, Editor, any custom roles, then each channel's owner. A preview of one person
// (People's "Preview as") adds that person, checked. Each option carries the setViewAs payload.
export function viewAsOptions(viewer = {}) {
  if (!isRealAdmin(viewer)) return [];
  const channels = list(viewer.channels);
  const custom = list(viewer.roles).filter((role) => role?.id && !BUILT_IN.has(role.id) && role.base !== 'admin');
  const firstChannel = channels[0] || null;
  const options = [
    { value: 'admin', label: 'Admin (you)', group: 'roles', payload: { role: 'admin' } },
    { value: 'editor', label: 'Editor', group: 'roles', payload: { role: 'editor' } },
    ...custom.filter((role) => role.base !== 'channel' || firstChannel).map((role) => (role.base === 'channel'
      ? { value: `role:${role.id}`, label: `${role.label || 'Custom role'} · ${firstChannel.short || firstChannel.name}`, group: 'roles', payload: { role: role.id, channelId: firstChannel.id } }
      : { value: `role:${role.id}`, label: role.label || 'Custom role', group: 'roles', payload: { role: role.id } })),
    ...channels.map((channel) => ({ value: `channel:${channel.id}`, label: channel.name, group: 'channels', payload: { role: 'channel', channelId: channel.id } })),
  ];
  const memberId = viewer.preview && viewer.viewAs?.memberId;
  if (memberId) options.push({ value: `member:${memberId}`, label: viewer.previewName || 'One person', group: 'people', payload: { ...viewer.viewAs } });
  return options;
}
// Which View as option is on: the person being previewed, the previewed role (and channel), or Admin.
export function viewAsChoice(viewer = {}, options = viewAsOptions(viewer)) {
  if (!viewer.preview) return 'admin';
  const want = viewer.viewAs || { role: viewer.role, channelId: viewer.channelId };
  if (want.memberId) return `member:${want.memberId}`;
  const match = options.find((option) => option.payload.role === want.role && (!option.payload.channelId || option.payload.channelId === (want.channelId || viewer.channelId)));
  return match?.value || (viewer.role === 'editor' ? 'editor' : 'admin');
}

// The channels "My channels" offers: the admin's list from the server, else the edition's kit folders.
export function focusChannelOptions(viewer = {}, edition = 'general') {
  const given = list(viewer.channels).filter((row) => row?.id);
  if (given.length) return given.map(({ id, name, short }) => ({ id, name: name || short || id, short: short || name || id }));
  const editionId = edition === 'semrush' ? 'semrush' : 'general';
  const offered = (deliverableId) => { const only = KIT.editionOnly?.[deliverableId]; return !only || only.includes(editionId); };
  return list(KIT.folders).filter((folder) => list(folder.deliverables).some(offered)).map((folder) => ({ id: folder.id, name: folder[editionId] || folder.id, short: folder[`${editionId}Short`] || folder[editionId] || folder.id }));
}
export const MAX_FOCUS_CHANNELS = 6;

function item(page, extra) {
  return { id: page.id, label: page.label, icon: page.icon, shortcut: '', badge: 0, badgeLabel: '', live: false, liveLabel: '', warn: false, warnLabel: '', spot: page.spot || `nav.${page.id}`, kind: 'app', target: page.id, ...extra };
}

/**
 * @param {Object} options
 * @param {Object} options.viewer  state.viewer (or LOCAL_ADMIN_FALLBACK).
 * @param {'simple'|'classic'|'channel'} options.layout
 * @param {Object} [options.state]  The pushed studio state (keys, contentStudio).
 * @param {{ waiting?: number, channelNew?: number }} [options.counts]  Work waiting on this person. `waiting`: trends that
 *   need their OK (App's board, which knows decisions made a moment ago). `channelNew` defaults to channelView.counts.
 * @param {'semrush'|'general'} [options.edition]
 * @param {number} [options.inboxUnread]  Unread Inbox rows (inbox-model.js buildInbox().unread).
 * @param {(method: string) => boolean} [options.can]  Whether this person may call a method AND the studio offers it.
 *   Defaults to the viewer's own list.
 * @param {boolean} [options.hasStudio]  The content studio is available (api.contentCatalog).
 * @param {boolean} [options.dataToolsOpen]
 */
export function buildNav({ viewer: given, layout = 'simple', state = {}, counts = {}, edition = 'general', inboxUnread = 0, can: canIn, hasStudio = true, dataToolsOpen = false } = {}) {
  const viewer = given || {};
  const can = typeof canIn === 'function' ? canIn : viewerCan(viewer);
  const hidden = new Set(list(viewer.hiddenPages));
  const nav = viewer.nav && typeof viewer.nav === 'object' ? viewer.nav : null;
  // The pages this role lists (viewer.nav, derived from capabilities); no nav (the Mac before its first push, old mocks)
  // lists every page. Capabilities, when present, can also take away the Data tools group.
  const listedMain = nav && Array.isArray(nav.main) ? new Set(nav.main) : null;
  const listedAdmin = nav && Array.isArray(nav.admin) ? new Set(nav.admin) : null;
  const caps = Array.isArray(viewer.capabilities) ? new Set(viewer.capabilities) : null;
  const studio = state?.contentStudio || {};
  const workspaceId = studio.activeWorkspaceId || '';
  const mine = (row) => !workspaceId || !row?.workspaceId || row.workspaceId === workspaceId;
  const channelShell = layout === 'channel';
  const semrush = edition === 'semrush';
  const modes = list(viewer.modes).length ? list(viewer.modes) : ['simple', 'classic'];
  const settingsAllowed = !channelShell && can('saveSettings') && !hidden.has('settings');
  const askAllowed = !channelShell && can('askHelp') && (layout !== 'simple' || ((!listedMain || listedMain.has('ask')) && !hidden.has('ask')));
  const simpleAllowed = (id) => (!listedMain || listedMain.has(id)) && !hidden.has(id);

  // Live work and warnings, from state; counts of work waiting on this person, from the caller.
  const researchRuns = list(studio.researchRuns).filter(mine);
  const contentRuns = list(studio.contentRuns).filter(mine);
  const researching = researchRuns.some((run) => ACTIVE.has(run.status));
  const kitsRunning = contentRuns.some((run) => run.kit && ACTIVE.has(run.status));
  const writing = contentRuns.some((run) => !run.kit && ACTIVE.has(run.status));
  const workflowsWaiting = Math.max(0, Number(studio.workflowSummary?.waiting) || 0);
  const workflowRunning = list(studio.workflows).some((row) => row?.running);
  const waiting = Math.max(0, Number(counts.waiting) || 0);
  const channelNew = Math.max(0, Number(counts.channelNew ?? studio.channelView?.counts?.newTrends) || 0);
  const unread = Math.max(0, Number(inboxUnread) || 0);
  const apifyMissing = Boolean(state?.keys) && !state.keys.APIFY_API_TOKEN;
  const needsOk = () => (waiting ? { badge: waiting, badgeLabel: `${waiting} ${waiting === 1 ? 'needs' : 'need'} your OK` } : {});
  const inboxBadge = unread ? { badge: unread, badgeLabel: `${unread} unread` } : {};

  const groups = [];
  if (channelShell) {
    const channelAllowed = (id) => (id === 'plan' ? !listedMain || listedMain.has('plan') || listedMain.has('calendar') : id === 'inbox' ? Boolean(listedMain?.has('inbox')) : !listedMain || listedMain.has(id));
    groups.push({ id: 'channel', label: '', collapsible: false, open: true, items: CHANNEL_PAGES.filter((page) => channelAllowed(page.id)).map((page) => item(page, {
      kind: 'channel', ...(page.id === 'trends' && channelNew ? { badge: channelNew, badgeLabel: `${channelNew} new` } : {}), ...(page.id === 'inbox' ? inboxBadge : {}),
    })) });
  } else if (layout === 'simple') {
    groups.push({ id: 'work', label: '', collapsible: false, open: true, items: SIMPLE_PAGES.filter((page) => simpleAllowed(page.id)).map((page) => item(page, {
      kind: 'simple',
      ...(page.id === 'trends' ? { ...needsOk(), live: researching || writing, liveLabel: researching ? 'research running' : 'reports being written' } : {}),
      ...(page.id === 'assets' ? { live: kitsRunning, liveLabel: 'channel assets being made' } : {}),
      ...(page.id === 'inbox' ? inboxBadge : {}),
    })) });
  } else {
    const appAllowed = (id) => !hidden.has(id) && (!['inbox', 'calendar'].includes(id) || simpleAllowed(id));
    const pageItem = (page) => item(page, {
      kind: page.kind, target: page.id,
      ...(page.id === 'board' ? needsOk() : {}),
      ...(page.id === 'research' ? { live: researching, liveLabel: 'research running' } : {}),
      ...(page.id === 'library' ? { live: kitsRunning, liveLabel: 'channel assets being made' } : {}),
      ...(page.id === 'create' ? { live: writing, liveLabel: 'content being written' } : {}),
      ...(page.id === 'inbox' ? inboxBadge : {}),
    });
    if (semrush && hasStudio) {
      groups.push({ id: 'research', label: 'Research', collapsible: false, open: true, items: RESEARCH_PAGES.filter((page) => appAllowed(page.id)).map(pageItem) });
      groups.push({ id: 'content', label: 'Content', collapsible: false, open: true, items: CONTENT_PAGES.filter((page) => appAllowed(page.id)).map(pageItem) });
    } else {
      groups.push({ id: 'workspace', label: 'Workspace', collapsible: false, open: true, items: WORKSPACE_PAGES.filter((page) => appAllowed(page.id) && (page.id !== 'content-studio' || !hidden.has('content-studio'))).map(pageItem) });
    }
    // Automate: Workflows shows what waits on this person (trends to OK, budgets) and a dot while a run is going.
    const automate = hasStudio ? AUTOMATE_PAGES.filter((page) => !hidden.has(page.id) && can(page.method)).map((page) => item(page, {
      kind: 'app', ...(page.id === 'workflows' ? { ...(workflowsWaiting ? { badge: workflowsWaiting, badgeLabel: `${workflowsWaiting} waiting on you` } : {}), live: workflowRunning, liveLabel: 'a workflow is running' } : {}),
    })) : [];
    if (automate.length) groups.push({ id: 'automate', label: 'Automate', collapsible: false, open: true, items: automate });
    const toolsOff = hidden.has('data-tools') || (caps && !caps.has('dataTools'));
    const subgroups = toolsOff ? [] : DATA_TOOLS.map((set) => ({ id: set.id, label: set.label, items: set.items.filter((page) => !hidden.has(page.id)).map((page) => item(page, { kind: 'app' })) })).filter((set) => set.items.length);
    if (subgroups.length) groups.push({ id: 'data', label: 'Data tools', collapsible: true, open: Boolean(dataToolsOpen), spot: 'nav.data-tools', items: subgroups.flatMap((set) => set.items), subgroups });
  }
  if (!channelShell) {
    const adminListed = (id) => !listedAdmin || listedAdmin.has(id);
    const studioItems = STUDIO_PAGES.filter((page) => adminListed(page.id) && !hidden.has(page.id) && can(page.method)).map((page) => item(page, { kind: 'admin' }));
    if (settingsAllowed) studioItems.push(item({ id: 'settings', label: 'Settings', icon: 'Settings2' }, { kind: 'settings', target: 'settings', shortcut: '⌘,', ...(apifyMissing ? { warn: true, warnLabel: 'Apify isn’t connected' } : {}) }));
    if (studioItems.length) groups.push({ id: 'studio', label: 'Studio', collapsible: false, open: true, items: studioItems });
  }
  groups.forEach((group) => group.items.forEach((row) => { row.group = group.id; }));

  // ⌘1–9 follow the visible order. Collapsible groups and Settings (⌘,) don't take a number.
  const order = groups.filter((group) => !group.collapsible).flatMap((group) => group.items).filter((row) => row.kind !== 'settings').slice(0, 9);
  order.forEach((row, index) => { row.shortcut = `⌘${index + 1}`; });

  // Quick create (the New menu and the palette's Create group). Admin-only rows come after a separator.
  const programs = list(studio.programs).filter(mine);
  const imagesReady = Boolean(state?.keys?.OPENAI_API_KEY) || Boolean(studio.capabilities?.imagesConfigured);
  const preview = Boolean(viewer.preview);
  const assetsPossible = modes.includes('simple') && simpleAllowed('assets');
  const workspaces = list(studio.workspaces);
  const create = channelShell ? [] : [
    hasStudio && can('startResearchRun') && { id: 'research', label: 'Find new trends', icon: 'Radar', hint: programs.length ? 'Runs a research program. You’ll see the cost first.' : 'Set up a research program first.', section: 'main', choices: programs.length > 1 ? programs.map((program) => ({ id: program.id, label: program.name || 'Untitled program' })) : [], programId: programs.length === 1 ? programs[0].id : '' },
    askAllowed && can('startQuickScan') && { id: 'quick-scan', label: 'Quick scan', icon: 'ScanSearch', hint: 'A small, recent scan, sized and priced by Ask AI.', section: 'main' },
    assetsPossible && can('planAssetKit') && can('createAssetKit') && { id: 'assets', label: 'Channel assets', icon: 'Images', hint: 'From a report, a Google Doc or pasted text.', section: 'main' },
    hasStudio && modes.includes('classic') && !hidden.has('create') && can('createContentRun') && { id: 'content', label: 'Content from a report', icon: 'SquarePen', hint: 'Opens Create content in the Advanced layout.', section: 'main' },
    askAllowed && can('createHelpImage') && (imagesReady
      ? { id: 'picture', label: 'Picture', icon: 'ImagePlus', hint: 'Ask AI drafts it with you. You see the cost first.', section: 'main' }
      : settingsAllowed ? { id: 'picture', label: 'Picture', icon: 'ImagePlus', hint: 'Pictures are off. Turn them on in Settings.', section: 'main' }
        : { id: 'picture', label: 'Picture', icon: 'ImagePlus', hint: 'Ask an admin to turn on pictures.', section: 'main', disabled: true, title: 'Pictures are off for your team.' }),
    hasStudio && !hidden.has('research') && can('saveResearchProgram') && { id: 'program', label: 'Research program', icon: 'Radar', hint: 'What to follow, the window and the budgets.', section: 'admin' },
    hasStudio && !hidden.has('playbooks') && can('applyPlaybook') && { id: 'playbook', label: 'Playbook', icon: 'LayoutGrid', hint: 'Research, approvals, reports and assets set up in one go. You see the cost first.', section: 'admin' },
    // Inviting is the browser studio's (People on the Mac has no invite), so the Mac never offers it.
    viewer.web && groups.some((group) => group.items.some((row) => row.id === 'people')) && (can('inviteMembers') || can('saveMember')) && { id: 'person', label: 'Person', icon: 'UserPlus', hint: 'Invite someone and choose their role.', section: 'admin' },
    isRealAdmin(viewer) && workspaces.length > 0 && studio.workspacePolicy?.mode !== 'single' && can('saveContentWorkspace') && can('selectContentWorkspace') && { id: 'workspace', label: 'Workspace', icon: 'Building2', hint: 'A separate set of programs, trends and reports.', section: 'admin' },
  ].filter(Boolean).map((row) => (preview && row.section === 'admin' ? { ...row, disabled: true, title: PREVIEW_TITLE } : { disabled: false, title: '', choices: [], programId: '', ...row }));

  const actions = {
    create,
    search: channelShell ? null : { label: 'Search…', shortcut: '⌘K', spot: 'nav.find' },
    ask: askAllowed ? { id: 'ask', label: 'Ask AI', icon: 'Sparkles', shortcut: '⌘J', spot: 'nav.ask', mode: layout === 'simple' ? 'page' : 'drawer' } : null,
  };
  const footer = {
    layouts: !channelShell && !isChannelViewer(viewer) && modes.includes('simple') && modes.includes('classic') ? LAYOUTS.map((row) => ({ ...row })) : [],
    viewAs: viewAsOptions(viewer),
    channels: channelShell || isChannelViewer(viewer) ? [] : focusChannelOptions(viewer, edition),
  };
  const have = { search: Boolean(actions.search), ask: Boolean(actions.ask), create: create.length > 0, settings: settingsAllowed, rail: true, '': true };
  const shortcuts = [
    ...order.map((row) => ({ keys: row.shortcut, label: row.label })),
    ...GLOBAL_SHORTCUTS.filter((row) => have[row.when]).map(({ keys, label }) => ({ keys, label })),
  ];
  return { layout, groups, actions, footer, order, shortcuts };
}

// Every page a layout has, flat (Data tools included even while closed), for the palette and the breadcrumb.
export const navPages = (model) => list(model?.groups).flatMap((group) => group.items);
// The General edition's content-studio tabs, which its sidebar doesn't list but the palette does.
export function generalStudioTabs({ viewer, hasStudio = true } = {}) {
  if (!hasStudio) return [];
  const hidden = new Set(list(viewer?.hiddenPages));
  return GENERAL_STUDIO_TABS.filter((tab) => !hidden.has(tab.id)).map((tab) => item(tab, { kind: 'studio', target: tab.id, spot: `nav.${tab.id}` }));
}
// The item a page id belongs to in this model (for aria-current and the breadcrumb), or null.
export const findNavItem = (model, id) => navPages(model).find((row) => row.id === id) || null;
// "Trends, 3 need your OK" · "Research programs, research running" · "Settings, Apify isn’t connected": what a badge or
// dot means, in words, for the button's accessible name (the visible number is aria-hidden).
export function itemName(row) {
  const note = row.badge > 0 ? row.badgeLabel || `${row.badge} new` : row.warn ? row.warnLabel : row.live ? row.liveLabel : '';
  return note ? `${row.label}, ${note}` : row.label;
}
