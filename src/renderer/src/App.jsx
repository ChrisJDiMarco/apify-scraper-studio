import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCheck, ChevronRight, ClipboardCopy, Command, Globe2, Inbox, ListChecks, LoaderCircle, RefreshCw, Repeat2, ScrollText, Sparkles, UserRound, Workflow, X } from 'lucide-react';
import { AutomationView } from './automation-view.jsx';
import { DatasetsView, ReportsView } from './dataset-report-views.jsx';
import { CommandPalette } from './command-palette.jsx';
import { WorkflowsView } from './workflows-view.jsx';
import { PlaybooksView } from './playbooks-view.jsx';
import { PlaybookSetup } from './playbook-setup.jsx';
import { PALETTE_GROUPS, paletteContent } from './palette-content.js';
import { Spotlight, spotFor } from './spotlight.jsx';
import { ThreadsView } from './ops-views.jsx';
import { ActivityView } from './activity-view.jsx';
import { DatasetHub } from './dataset-hub.jsx';
import { LegacyLibrary } from './legacy-library.jsx';
import { MARKETING_TEMPLATES } from '../../shared/marketing-templates.js';
import { TemplateLibraryView } from './template-library-view.jsx';
import { BrandContextView } from './brand-context-view.jsx';
import { ImportDataView } from './import-data-view.jsx';
import { CompareView } from './compare-view.jsx';
import { MarketingTemplateView } from './marketing-template-view.jsx';
import { SearchView } from './search-view.jsx';
import { FindingsChatView } from './findings-chat-view.jsx';
import { ContentStudioView } from './content-studio-view.jsx';
import { HomeView } from './home-view.jsx';
import { SettingsView } from './settings-view.jsx';
import { HelpAssistant } from './help-assistant.jsx';
import { canWriteReports, useStudioActions } from './studio-actions.js';
import { KitCreatorHost, kitSourcesFrom } from './kit-creator.jsx';
import { useAnnouncingApi } from './help-images.js';
import { defaultProgram, lastProgramId } from './choices.js';
import { nextSteps } from './next-steps.js';
import { briefingData, briefingMarkdown } from './weekly-briefing.jsx';
import { useConfirm } from './confirm-dialog.jsx';
import { SheetsView } from './sheets-view.jsx';
import { SimpleMode } from './simple-mode.jsx';
import { ChannelBottomNav, NAV_ICONS, StudioSidebar, StudioTopBar } from './studio-sidebar.jsx';
import { DATA_TOOLS, DATA_TOOL_IDS, PAGE_LABELS, STUDIO_PAGES, buildNav, generalStudioTabs, isChannelViewer, isRealAdmin, navPages } from './nav-model.js';
import { InboxView, inboxUnread, markInboxRead } from './inbox-view.jsx';
import { CalendarView } from './calendar-view.jsx';
import { PromptLibrary } from './prompt-library.jsx';
import { LINK_COPIED, deepLinkTarget, linkFor, shareOrigin, useDeepLink } from './deep-links.js';
import { NoAccess, PreviewBanner, copyText, useNarrow, useToast } from './role-screens.jsx';
import { ChannelAssets, ChannelPlan, ChannelTrends } from './channel-owner.jsx';
import { ChannelAskPage } from './channel-ask.jsx';
import { AnalyticsView } from './analytics-view.jsx';
import { PeopleView } from './people-view.jsx';
import { UnsavedContext, createUnsavedGuard } from './asset-editor.jsx';
import { requestNoteFocus } from './report-editor/events.js';
import { LOCAL_ADMIN_FALLBACK, PREVIEW_TITLE, ViewerContext, adminNames, can as canCall, canRun as canRunCall, roleLabel } from './viewer.js';
import { Button, StatusBanner, number, withViewTransition } from './ui.jsx';
import { isMac } from './platform.js';
import './studio-frame.css';

// What disconnecting each credential stops, so the confirmation says what is at stake.
const KEY_CONSEQUENCE = {
  APIFY_API_TOKEN: ['your Apify token', 'Scrapers and research collection stop until you reconnect it.'],
  ANTHROPIC_API_KEY: ['the Anthropic API key', 'Research and drafts use the Claude app instead, if it is installed and signed in.'],
  OPENAI_API_KEY: ['the OpenAI key', 'Pictures and OpenAI models routed to it stop before spending until you add it again.'],
  GOOGLE_SHEETS_WEBHOOK_URL: ['the Google Sheets bridge', 'Sending rows to Sheets and pulling tabs stop until you add it again.'],
  GOOGLE_DOCS_ACCESS_TOKEN: ['Google Docs access', 'Importing Google Docs and publishing to Drive stop until you reconnect.'],
  MONDAY_API_TOKEN: ['Monday.com', 'Syncing with your board stops. Items on Monday stay.'],
  OPENROUTER_API_KEY: ['the OpenRouter key', 'Jobs routed to OpenRouter stop before spending until you add a key again.'],
  FAL_KEY: ['the fal.ai key', 'Pictures and videos routed to fal.ai stop before spending until you add a key again.'],
};
// The in-app question before a data job is cancelled (the Working popover and Scraper runs).
const CANCEL_JOB = { title: 'Cancel this job?', lines: ['Anything it already finished is kept.'], confirmLabel: 'Cancel job', cancelLabel: 'Keep it running', tone: 'danger' };

// The pages themselves (labels, icons, groups, ⌘ numbers) live in nav-model.js, which the sidebar, the palette and the
// shortcuts all read. App keeps what routing needs: which ids are studio views, which are app pages, and the Studio
// group's pages with the method each needs.
const STUDIO_VIEWS = new Set(['overview', 'research', 'board', 'create', 'library', 'knowledge']);
const APP_PAGES = new Set(['content-studio', 'dashboard', 'sheets', 'settings', 'inbox', 'calendar', 'playbooks', 'workflows', ...DATA_TOOL_IDS]);
const ADMIN_PAGES = Object.fromEntries(STUDIO_PAGES.map((page) => [page.id, page]));
const DATA_TOOL_SPOTS = new Set(['nav.data-tools', ...DATA_TOOLS.flatMap((set) => set.items.map((item) => item.spot))]);
// Whether Data tools is open, per person on this device. Storage can be missing or blocked (private windows, previews).
const DATA_TOOLS_KEY = 'studio.nav.dataTools';
function savedDataToolsOpen() {
  try { const value = window.localStorage?.getItem(DATA_TOOLS_KEY); return value === '1' ? true : value === '0' ? false : null; } catch { return null; }
}
function saveDataToolsOpen(open) {
  try { window.localStorage?.setItem(DATA_TOOLS_KEY, open ? '1' : '0'); } catch { /* the choice still holds for this session */ }
}
// The icon-only rail: the person's choice is saved in their prefs (navRail) and on this device, as a fallback for
// older servers. With no choice, windows 861–1100px wide get the rail.
const RAIL_KEY = 'studio.nav.rail';
const RAIL_QUERY = '(min-width: 861px) and (max-width: 1100px)';
function savedRail() {
  try { const value = window.localStorage?.getItem(RAIL_KEY); return value === '1' ? true : value === '0' ? false : null; } catch { return null; }
}
function saveRail(on) {
  try { window.localStorage?.setItem(RAIL_KEY, on ? '1' : '0'); } catch { /* the choice still holds for this session */ }
}
// Pages folded into a better home. Old links (palette, saved actions, other views) still land somewhere useful.
const DATASET_TAB_FOR = { signals: 'signals', threads: 'conversations', clusters: 'topics', competitive: 'coverage' };
const STUDIO_HOME_FOR = { kanban: 'board', assets: 'library', brands: 'knowledge' };
// Pages other modules draw, routed here in both layouts (and for channel owners, My plan and Inbox): renderSharedPage
// mounts each one. A studio too old for a page's methods (an older main process) shows what it holds instead.
const SHARED_PAGES = {
  inbox: { title: 'Inbox', icon: Inbox, detail: 'Trends that need your OK, what the channels used, edits to reports and finished runs show up here.' },
  calendar: { title: 'Calendar', icon: CalendarDays, detail: 'When a channel says it’s using a trend and adds a date, it shows up here, week by week.' },
  plan: { title: 'My plan', icon: CalendarDays, detail: 'Trends your channel is using, by the date you planned them for.' },
  prompts: { title: 'Prompts', icon: ScrollText, detail: 'The instructions behind research, reports and channel assets, with their versions. This version of the studio can’t open them yet.' },
};
// Show me steps on pages both layouts share (help-spots.json `tab`): Advanced opens the page first, as Simple does.
const SHARED_SPOT_PAGES = new Set(['inbox', 'calendar', 'prompts', 'people', 'analytics']);
const ACTIVE_RUN = new Set(['queued', 'running']);
const list = (value) => (Array.isArray(value) ? value : []);
const EMPTY_STATE = {
  projects: [],
  recipes: [],
  runs: [],
  datasets: [],
  analyses: [],
  conversations: [],
  brandProfiles: [], researchReviews: [], researchAudit: [], researchExports: [], monitors: [], comparisons: [],
  apifyCatalog: { actors: [], syncedAt: '' },
  intentRuns: [],
  settings: {},
  keys: {},
  jobs: [],
  v5: { recipeVersions: {} }, // the retired v5 log's one projection still read (Scrapers' saved versions)
  intelligence: {
    datasetProfiles: [],
    nextActions: [],
    readiness: { percent: 0, doneCount: 0, total: 0, label: 'Needs setup', detail: '', currentStep: null, nextView: 'dashboard' },
    setupSteps: [],
    suggestedCommands: [],
    summary: '',
    operatorBrief: '',
    workPlan: [],
  },
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  // Moving to another page clears a page's error screen without remounting the page: remounting would throw away what
  // one studio view hands the next (the report attached to Create content, the file to select in the Library).
  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      // A page-level failure keeps the sidebar alive; only a shell failure replaces the window.
      return (
        <div className="app-fallback" role="alert">
          <strong>{this.props.page ? 'This page hit a problem.' : 'Golden Thread hit a problem.'}</strong>
          <span>Your saved work is safe. {this.props.page ? 'Try again, or open another page from the sidebar.' : 'Try again. If it keeps happening, restart the app.'}</span>
          <details><summary>Technical details</summary><code>{this.state.error.message || String(this.state.error)}</code></details>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ApiUnavailable() {
  return (
    <div className="app-fallback" role="alert">
      <strong>Desktop bridge unavailable.</strong>
      <span>Restart the packaged app or run it through Electron so local files, Apify, and Codex can be reached safely.</span>
    </div>
  );
}

// The Advanced top bar: the breadcrumb (workspace › page), quick work in progress, and Refresh. Search and Ask AI are in
// the sidebar in every layout.
function Header({ title, workspaceName = 'Workspace', busy, background = [], onRefresh }) {
  const working = busy || background.length > 0;
  return <header className="topbar"><div className="breadcrumb"><span className="breadcrumb-root" title={workspaceName}>{workspaceName}</span><ChevronRight size={14} aria-hidden="true" /><h1>{title || 'Overview'}</h1></div><div className="topbar-right">{working && <span className="working-status" role="status" title={background.join('\n') || undefined}><LoaderCircle className="spin" size={14} aria-hidden="true" />{background.length === 1 && !busy ? `${background[0]}…` : background.length > 1 ? `${background.length} tasks running` : 'Working'}</span>}<Button className={`ghost icon-button ${busy ? 'is-working' : ''}`} aria-label="Refresh workspace" title="Refresh workspace" disabled={busy} onClick={onRefresh}><RefreshCw size={16} /></Button></div></header>;
}
// A page whose component isn't mounted in this build yet: what it will hold, in plain words.
function PagePlaceholder({ id }) {
  const page = SHARED_PAGES[id] || { title: PAGE_LABELS[id] || 'This page', icon: Command, detail: '' };
  const Icon = page.icon;
  return <section className="studio-page" aria-labelledby={`page-${id}-title`}><div className="studio-empty big"><Icon size={26} aria-hidden="true" /><h2 id={`page-${id}-title`}>{page.title}</h2><p>{page.detail || 'This page isn’t available in this version of the studio yet.'}</p></div></section>;
}
// "Collecting posts…", "Starting soon": one line about where a live run is.
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
function runLine(run) {
  if (run.status === 'queued') return 'Starting soon';
  if (run.message) return run.message;
  if (run.stage) return `${readable(run.stage)}…`;
  return 'Working…';
}
export default function App() {
  return <ErrorBoundary>{window.apifyStudio ? <StudioApp api={window.apifyStudio} /> : <ApiUnavailable />}</ErrorBoundary>;
}

function StudioApp({ api }) {

  const [meta, setMeta] = useState(null);
  // The browser studio runs on a server: "open" and "reveal" become downloads there.
  const web = meta?.runtime === 'web';
  const fileNotice = (desktopText) => (web ? 'Download started.' : desktopText);
  const revealed = isMac() ? 'revealed in Finder' : 'shown in File Explorer';
  const [state, setState] = useState(EMPTY_STATE);
  // Who is looking, as the server projected it. Old mocks and the Mac before its first push act as the local admin.
  const viewer = state.viewer || LOCAL_ADMIN_FALLBACK;
  const can = useCallback((method) => canCall(viewer, method), [viewer]); // shown: in a preview, the previewed role's controls
  const canRun = useCallback((method) => canRunCall(viewer, method), [viewer]); // taken by the server now
  const hiddenPages = useMemo(() => new Set(list(viewer.hiddenPages)), [viewer]);
  const role = viewer.role;
  // Custom roles carry a base (editor or channel); the built-in ids are their own base.
  const channelBase = isChannelViewer(viewer);
  const realAdmin = isRealAdmin(viewer);
  const settingsAllowed = can('saveSettings') && !hiddenPages.has('settings');
  const askAllowed = Boolean(api.askHelp) && can('askHelp');
  const askAdmin = adminNames(state, 'an admin');
  // What a page this role can't open says. Settings and People are admin-only (roles.json lock 'admin'); every other
  // page is a capability an admin can grant to this role or this person, so it names whom to ask.
  const pageOffNotice = (view) => {
    if (view === 'settings') return `Settings are for admins. Ask ${askAdmin} if something needs changing.`;
    if (view === 'people') return 'People & access is for admins.';
    if (viewer.preview) return 'That page isn’t part of the role you’re previewing.';
    return `${PAGE_LABELS[view] || 'That page'} isn’t part of your access. Ask ${askAdmin} if you need it.`;
  };
  // Unsaved edits (a report, a prompt, a program), asked about before any navigation. One click asks once: when several
  // steps of the same click ask (a page's own tab bar, then the shell), the first "leave" stands until the click is over.
  const guard = useMemo(() => {
    const base = createUnsavedGuard();
    let agreed = false;
    return { ...base, confirmLeave: (message) => {
      if (agreed || !base.isDirty()) return true;
      const ok = base.confirmLeave(message);
      if (ok) { agreed = true; queueMicrotask(() => { agreed = false; }); }
      return ok;
    } };
  }, []);
  const confirm = useConfirm();
  const [active, setActive] = useState(api.contentCatalog ? 'content-studio' : 'dashboard');
  const [studioView, setStudioView] = useState('overview');
  const [createWorkspaceKey, setCreateWorkspaceKey] = useState(0);
  const contentWorkspaces = list(state.contentStudio?.workspaces);
  const contentWorkspace = contentWorkspaces.find(item => item.id === state.contentStudio?.activeWorkspaceId);
  const semrushShell = contentWorkspace?.editionId === 'semrush';
  // Only a real admin switches the workspace everyone uses; the sidebar turns the picker off while previewing. A
  // one-workspace build (package.json studioWorkspace, or STUDIO_WORKSPACE_MODE=single) has no switcher and no New workspace.
  const singleWorkspace = state.contentStudio?.workspacePolicy?.mode === 'single';
  const switchWorkspace = contentWorkspace && api.selectContentWorkspace && realAdmin && !singleWorkspace ? (id) => { if (guard.confirmLeave()) runAction(() => api.selectContentWorkspace(id)); } : undefined;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingActions, setPendingActions] = useState(0);
  const busy = pendingActions > 0;
  const [loading, setLoading] = useState(true);
  // Data tools stays as the person left it (null: never chosen, so it opens only where there's no content studio).
  const [dataToolsChoice, setDataToolsChoice] = useState(savedDataToolsOpen);
  const dataToolsOpen = dataToolsChoice ?? !api.contentCatalog;
  const [datasetTab, setDatasetTab] = useState('explorer');
  const [knowledgeTab, setKnowledgeTab] = useState('workspace');
  const [creation, setCreation] = useState({ key: null, templateId: '' });
  const contentRef = useRef(null);
  const frameRef = useRef(null);
  const cardScrollTimer = useRef(null);
  useEffect(() => () => clearTimeout(cardScrollTimer.current), []);
  const [payloadDatasetId, setPayloadDatasetId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSeed, setHelpSeed] = useState(null); // a question for the Advanced Ask AI drawer to ask ({ text, key })
  const [classicContext, setClassicContext] = useState({}); // what an Advanced page has open ({ report, folder, run, trend }), for Ask AI
  const [classicTour, setClassicTour] = useState(null); // an Ask AI "Show me" running in the Advanced layout
  // Requests for pages that own their state: SimpleMode (open a report, ask Ask AI) and the Advanced Library (select an
  // asset). Each carries a fresh key; a page acts on a key once.
  const [shellRequest, setShellRequest] = useState(null); // { key, kind: 'report', assetId } | { key, kind: 'ask', text }
  const [libraryRequest, setLibraryRequest] = useState(null); // { key, assetId } (a report) | { key, folderKey } (a channel-asset folder)
  // Simple is the default layout. "peek" opens one Advanced page from Simple for this session, without saving a preference.
  const [peek, setPeek] = useState(false);
  const [modeChoice, setModeChoice] = useState(''); // the layout just chosen, shown before the saved preference comes back
  const [simpleTab, setSimpleTab] = useState('home');
  const [channelTab, setChannelTab] = useState('trends');
  const [channelFocus, setChannelFocus] = useState('');
  const [channelCache, setChannelCache] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The rail: this session's choice, else the person's saved one, else this device's, else the window width decides.
  const [sessionRail, setSessionRail] = useState(null);
  const [localRail] = useState(savedRail);
  const midWidth = useNarrow(RAIL_QUERY);
  const [newMenuKey, setNewMenuKey] = useState(0); // ⌥⌘N opens the sidebar's New menu
  const [peopleRequest, setPeopleRequest] = useState(null); // { kind: 'invite', key, preset? } opens Invite, { kind: 'person', key, memberId } that person's sheet, once
  const [programRequest, setProgramRequest] = useState(null); // { kind: 'new', key }: Research programs opens a new program
  const [runRequest, setRunRequest] = useState(null); // { key, runId }: Research programs or Create content selects that run once
  const [createRequest, setCreateRequest] = useState(null); // { key, mode: 'report' }: Create content opens on "Use a report"
  const [promptRequest, setPromptRequest] = useState(null); // { key, promptId, tab? }: Prompts opens that prompt once
  const [channelTrendFocus, setChannelTrendFocus] = useState(''); // a trend's brief to open on a channel owner's Trends (a share link, an Inbox row)
  const [channelSeed, setChannelSeed] = useState(null); // a question for a channel owner's Ask AI page ({ key, text } or { key, draft })
  const [channelLastTab, setChannelLastTab] = useState('trends'); // the channel page Ask AI was opened from, for its context
  const [inboxSeen, setInboxSeen] = useState(0); // bumps after Mark all read, so the badge also reads this browser's copy
  const [roleEpoch, setRoleEpoch] = useState(0); // bumps when someone else changes this person's role, to close open sheets
  const narrow = useNarrow();
  const [payload, setPayload] = useState(null);
  const [sheetRequest, setSheetRequest] = useState({ id: '', key: 0 });
  const [payloadError, setPayloadError] = useState('');
  const [payloadAttempt, setPayloadAttempt] = useState(0);
  const [background, setBackground] = useState({});
  const backgroundRef = useRef({});
  const datasetKey = state.datasets.map((dataset) => `${dataset.id}:${dataset.itemCount}:${dataset.createdAt}`).join('|');

  // What this role may open, from the same nav model the sidebar draws (nav-model.js): its Simple pages, the Studio
  // pages, and Advanced pages not hidden from it. These shapes carry no counts; the sidebar's model (below, once the
  // board is known) adds them. A Studio page needs its method in this studio too; Settings opens wherever it's allowed.
  const navCan = (method) => can(method) && (method === 'saveSettings' || typeof api[method] === 'function');
  const navBase = { viewer, state, edition: semrushShell ? 'semrush' : 'general', can: navCan, hasStudio: Boolean(api.contentCatalog), dataToolsOpen };
  const simpleShape = buildNav({ ...navBase, layout: 'simple' });
  const classicShape = buildNav({ ...navBase, layout: 'classic' });
  const channelShape = buildNav({ ...navBase, layout: 'channel' });
  const simplePages = navPages(simpleShape);
  const simpleIds = new Set(simplePages.map((row) => row.id));
  const classicIds = new Set(navPages(classicShape).map((row) => row.id));
  const channelIds = navPages(channelShape).map((row) => row.id);
  const askPage = Boolean(simpleShape.actions.ask);
  // A channel owner's Ask AI page, when their role has Use Ask AI (its answers come from their channel only).
  const channelAsk = Boolean(channelShape.actions.ask);
  // Simple's pages in nav order (⌘1–9), then Ask AI, for SimpleMode and the Ask AI buttons that open a tab.
  const simpleTabs = [...simpleShape.order.map((row) => row.target), ...simplePages.filter((row) => row.kind !== 'settings' && !simpleShape.order.includes(row)).map((row) => row.target), ...(askPage ? ['ask'] : [])];
  const adminPages = simplePages.filter((row) => row.kind === 'admin').map((row) => row.id);
  const simpleAllowed = (id) => (id === 'ask' ? askPage : simpleIds.has(id) || (id === 'settings' && settingsAllowed));
  const studioAllowed = (view) => !hiddenPages.has(view);
  function pageAllowed(view) {
    const studio = STUDIO_HOME_FOR[view] || (STUDIO_VIEWS.has(view) ? view : '');
    if (studio) return studioAllowed(studio);
    if (view === 'inbox' || view === 'calendar') return classicIds.has(view);
    // The data-tools pages hide as one group ('data-tools'), as the sidebar (nav-model.js) and Ask AI already read it.
    if (DATA_TOOL_IDS.includes(view) && hiddenPages.has('data-tools')) return false;
    return !hiddenPages.has(view) && (view !== 'settings' || settingsAllowed) && (!ADMIN_PAGES[view] || adminPages.includes(view));
  }

  // The sidebar's Inbox badge (inbox-view.jsx): rows derived from state, unread since prefs.inboxSeenAt or this browser's
  // copy of it, whichever is later. A model that throws leaves the badge off rather than taking the frame down.
  const inboxCount = useMemo(() => {
    try { return Math.max(0, Number(inboxUnread(state, viewer)) || 0); } catch { return 0; }
  }, [state, viewer, inboxSeen]);
  // Share links point at the browser studio: this page's address there, the saved Studio web address on the Mac.
  const linkOrigin = shareOrigin({ web, settings: state.settings });

  // The layout: channel owners have their own; otherwise this person's saved choice, or Advanced while peeking.
  const modes = list(viewer.modes).length ? viewer.modes : ['simple', 'classic'];
  const savedMode = viewer.prefs?.uiMode || state.settings?.uiMode || 'simple';
  const wantedMode = modeChoice || (peek ? 'classic' : savedMode);
  const mode = channelBase ? 'channel' : modes.includes(wantedMode) ? wantedMode : 'simple';
  const prefRail = typeof viewer.prefs?.navRail === 'boolean' ? viewer.prefs.navRail : null;
  const rail = !narrow && Boolean(sessionRail ?? prefRail ?? localRail ?? midWidth);

  async function refresh() {
    const [nextMeta, nextState] = await Promise.all([api.appMeta(), api.state()]);
    setMeta(nextMeta);
    setState({ ...EMPTY_STATE, ...nextState });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message || String(err))).finally(() => setLoading(false));
    return api.onStateChanged((next) => setState({ ...EMPTY_STATE, ...next }));
  }, []);

  // One keyboard handler for every layout (keysRef is filled in below, once the nav model is known): ⌘1–9 open pages in
  // nav order, ⌘K search, ⌘J Ask AI (Simple's page, Advanced's drawer), ⌘, Settings, ⌘\ the rail, ⌥⌘N the New menu,
  // and Esc closes the palette. ⌥⌘N is also matched by code, since ⌥ changes event.key on the Mac (⌥N is a dead key).
  // Windows reports AltGr as Ctrl+Alt, so Ctrl+Alt+N matches event.key, not the code, and AltGr is let through: on some
  // layouts AltGr+N types a character (ń on Polish, } on Czech). The AltGr check skips ⌘, since Firefox on the Mac reports
  // ⌥ as AltGraph.
  const keysRef = useRef({});
  useEffect(() => {
    function onKeyDown(event) {
      const keys = keysRef.current;
      if (event.key === 'Escape') { setPaletteOpen(false); return; }
      if (!(event.metaKey || event.ctrlKey) || event.isComposing || !keys.mode) return;
      const code = event.code || '';
      if (event.altKey) {
        if (!event.metaKey && event.getModifierState?.('AltGraph')) return;
        // The code still counts with ⌘, or when the key isn't a Latin character: a Russian, Greek or Hebrew layout has no
        // AltGr level, so its Ctrl+Alt+N reports the layout's own letter (т, ν, מ).
        const isN = String(event.key).toLowerCase() === 'n' || (code === 'KeyN' && (event.metaKey || /[^\u0000-\u024F]/.test(String(event.key))));
        if (isN && !event.shiftKey && keys.canCreate) { event.preventDefault(); setPaletteOpen(false); keys.openNew(); }
        return;
      }
      if (event.shiftKey) return;
      const key = String(event.key).toLowerCase();
      if (key === 'k' && keys.mode !== 'channel') { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      if (key === 'j' && keys.canAsk) { event.preventDefault(); setPaletteOpen(false); keys.toggleAsk(); return; }
      if ((event.key === ',' || code === 'Comma') && keys.settingsAllowed && keys.mode !== 'channel') { event.preventDefault(); setPaletteOpen(false); keys.openSettings(); return; }
      if ((event.key === '\\' || code === 'Backslash') && keys.canRail) { event.preventDefault(); keys.toggleRail(); return; }
      const digit = /^Digit([1-9])$/.exec(code)?.[1] || (/^[1-9]$/.test(event.key) ? event.key : '');
      const row = digit ? keys.order?.[Number(digit) - 1] : null;
      if (row) { event.preventDefault(); setPaletteOpen(false); keys.openNavItem(row); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => { contentRef.current?.scrollTo?.(0, 0); }, [active, studioView]);

  // The palette's prompts and people (admins), read each time it opens; a role change drops them.
  const [paletteData, setPaletteData] = useState({ prompts: null, people: null });
  useEffect(() => {
    if (!paletteOpen) return undefined;
    let live = true;
    const keep = (key) => (rows) => { if (live) setPaletteData((current) => ({ ...current, [key]: rows })); };
    // Read again on every open (the old rows stay up meanwhile): People and Prompts change while the palette is closed.
    if (typeof api.listPrompts === 'function' && can('listPrompts') && !hiddenPages.has('prompts')) Promise.resolve().then(() => api.listPrompts()).then((result) => keep('prompts')(list(result?.prompts)), () => keep('prompts')([]));
    if (typeof api.getTeam === 'function' && can('getTeam') && !hiddenPages.has('people')) Promise.resolve().then(() => api.getTeam()).then((result) => keep('people')(list(result?.members)), () => keep('people')([]));
    return () => { live = false; };
  }, [paletteOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notices leave on their own, but never while the pointer is resting on them.
  const [noticeHeld, setNoticeHeld] = useState(false);
  useEffect(() => {
    if (!notice && !error) setNoticeHeld(false); // the banner unmounted under the pointer, so no mouseleave arrives
    if (!notice || noticeHeld) return;
    const timeout = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timeout);
  }, [notice, error, noticeHeld]);

  // A dataset's full rows are read only while the Datasets page (the one page that shows them) is open in Advanced;
  // leaving it drops them, and opening it again reads them fresh.
  const needsPayload = mode === 'classic' && active === 'datasets';
  useEffect(() => {
    let cancelled = false;
    const datasetId = state.datasets.find((item) => item.id === selectedDatasetId)?.id || state.datasets[0]?.id || '';
    setPayload(null);
    setPayloadDatasetId('');
    setPayloadError('');
    if (!needsPayload || !datasetId || !api.readDataset || !can('readDataset')) {
      setPayload(null);
      return;
    }
    if (datasetId !== selectedDatasetId) setSelectedDatasetId(datasetId);
    api.readDataset(datasetId).then((nextPayload) => {
      if (!cancelled) { setPayload(nextPayload); setPayloadDatasetId(datasetId); }
    }).catch((err) => {
      // The dataset page shows this in place, with a retry; no banner far from where people are looking.
      if (!cancelled) setPayloadError(err.message || String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDatasetId, datasetKey, payloadAttempt, needsPayload]);

  async function runAction(action, successMessage = '', throwOnError = false) {
    setPendingActions((count) => count + 1);
    setError('');
    setNotice('');
    try {
      const result = await action();
      await refresh();
      if (successMessage) setNotice(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      return result;
    } catch (err) {
      // Views that ask for the error back show it inline; the banner would only repeat it.
      if (throwOnError) throw err;
      setError(err.message || String(err));
      return null;
    } finally {
      setPendingActions((count) => Math.max(0, count - 1));
    }
  }

  // Long work (Apify runs, AI analysis, searches) runs in the background so every other page stays usable.
  // The same job can't be started twice while it is still going.
  async function runBackground(key, label, action, successMessage = '', throwOnError = false) {
    if (backgroundRef.current[key]) { setNotice(`${backgroundRef.current[key]} is still running. Its result will appear here when it finishes.`); return null; }
    backgroundRef.current = { ...backgroundRef.current, [key]: label }; setBackground(backgroundRef.current);
    try {
      const result = await action();
      await refresh();
      if (successMessage) setNotice(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      return result;
    } catch (err) {
      if (throwOnError) throw err;
      setNotice(''); setError(err.message || String(err));
      return null;
    } finally {
      const { [key]: _done, ...rest } = backgroundRef.current; backgroundRef.current = rest; setBackground(rest);
    }
  }

  const selectedDataset = useMemo(
    () => state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0] || null,
    [state.datasets, selectedDatasetId],
  );

  // Every Advanced page change asks about unsaved edits (the Library's report editor, Prompts) once; `confirmed`: the
  // caller already asked.
  function navigate(view, args = {}, { confirmed = false } = {}) {
    if (!confirmed && view !== active && !guard.confirmLeave()) return;
    withViewTransition(() => applyNavigation(view, args));
  }
  // A note that should outlive the page change it comes with ("That report isn’t in this workspace"): navigation clears
  // notices, and with view transitions it lands a frame later, so the note is carried across it for a moment.
  const carriedNotice = useRef({ text: '', until: 0 });
  function noticeAcross(text) { carriedNotice.current = { text, until: Date.now() + 2000 }; setNotice(text); }

  function applyNavigation(view, args = {}) {
    const carried = carriedNotice.current; carriedNotice.current = { text: '', until: 0 };
    setNotice(carried.until > Date.now() ? carried.text : '');
    setError('');
    // Workflows replaced the old missions page; old links still land there. A workflow (and run) to show rides along.
    if (view === 'missions') view = 'workflows';
    if (view === 'workflows' && (args.workflowId || args.runId)) setWorkflowRequest({ key: Date.now(), workflowId: String(args.workflowId || ''), runId: String(args.runId || ''), run: args.run === true });
    // Pages this role can't open (Settings for an editor, an old link to Brand knowledge) say so instead of opening.
    if (!pageAllowed(view)) { setNotice(pageOffNotice(view)); return; }
    if (args.datasetId) setSelectedDatasetId(args.datasetId);
    if (view === 'sheets' && args.workbookId) setSheetRequest((current) => ({ id: args.workbookId, key: current.key + 1 }));
    if (STUDIO_HOME_FOR[view]) {
      if (view === 'brands') setKnowledgeTab('profiles');
      setStudioView(STUDIO_HOME_FOR[view]);
      setActive('content-studio');
      return;
    }
    if (DATASET_TAB_FOR[view]) { setDatasetTab(DATASET_TAB_FOR[view]); view = 'datasets'; }
    else if (view === 'datasets' && args.tab) setDatasetTab(args.tab);
    const nextView = (view === 'marketing-template' || ADMIN_PAGES[view] || APP_PAGES.has(view)) ? view : 'dashboard';
    if (args.create || args.templateId || args.reportPresetId || args.analysisId) setCreation((current) => ({ key: (current.key || 0) + 1, templateId: args.templateId || '', reportPresetId: args.reportPresetId || '', analysisId: args.analysisId || '' }));
    else if (['reports', 'imports'].includes(nextView)) setCreation({ key: null, templateId: '', reportPresetId: '', analysisId: '' });
    else if (nextView === 'automation') setCreation({ key: null, templateId: '' });
    // Data tools stays as the person left it; when it's closed, its toggle names the page that's open inside.
    setActive(nextView);
  }

  // Ask AI's "Open" buttons name a studio view (Research programs, Library…) or an app page (Sheets, Settings…).
  function openHelpPage(page) {
    if (STUDIO_VIEWS.has(page)) navigateStudio(page);
    else navigate(page);
  }

  function navigateStudio(view, { confirmed = false } = {}) {
    if (!studioAllowed(view)) { setNotice(pageOffNotice(view)); return; }
    if (!confirmed && !(active === 'content-studio' && studioView === view) && !guard.confirmLeave()) return;
    withViewTransition(() => {
      setStudioView(view);
      applyNavigation('content-studio');
    });
  }

  // From Simple: open one Advanced page (See why, research setup, Ask AI links, the palette, the Trend tracker) without
  // saving a layout. A "Back to Simple" bar stays above the page until the person goes back or keeps Advanced. `args`
  // go with it (Sheets takes { workbookId }; Research programs and Create content take { runId }, the run to show).
  function openClassicPage(view, args = {}, { confirmed = false } = {}) {
    if (!pageAllowed(view)) { setNotice(pageOffNotice(view)); return; }
    if (!confirmed && !guard.confirmLeave()) return;
    setPeek(true); setDrawerOpen(false);
    if (STUDIO_VIEWS.has(view)) {
      if (args.runId && (view === 'research' || view === 'create')) setRunRequest({ key: Date.now(), runId: String(args.runId) });
      if (args.programId && view === 'research') setProgramRequest({ kind: 'edit', key: Date.now(), programId: String(args.programId) }); // Home's program drawer: Open full page
      navigateStudio(view, { confirmed: true });
    } else navigate(view, args, { confirmed: true });
  }
  // One run where it shows its progress (Research programs or Create content), with that run selected: the Inbox, Next
  // up, Ask AI, the Working popover, Sheets and Activity all open runs this way in the Advanced layout.
  function openStudioRun(view, runId) { openStudioWith(view, runId ? () => setRunRequest({ key: Date.now(), runId: String(runId) }) : null); }
  // A studio page opened with a request for it (the run to select, a new program, Ask AI's draft): unsaved edits are
  // asked about first, so a "Stay" never leaves the request behind for a later visit. From Simple it opens as a peek.
  function openStudioWith(view, request) {
    if (!pageAllowed(view)) { setNotice(pageOffNotice(view)); return; }
    if (!(mode !== 'simple' && active === 'content-studio' && studioView === view) && !guard.confirmLeave()) return;
    request?.();
    if (mode === 'simple') openClassicPage(view, {}, { confirmed: true });
    else navigateStudio(view, { confirmed: true });
  }
  // Simple's pages, the sidebar and ⌘1–9 all come here, so unsaved report edits are asked about once.
  const simpleTabRef = useRef(simpleTab); simpleTabRef.current = simpleTab;
  function goSimple(next) {
    if (!simpleAllowed(next)) return;
    if (next !== simpleTabRef.current && !guard.confirmLeave()) return;
    withViewTransition(() => setSimpleTab(next));
  }
  // `focus` is a trend to jump to in My assets, once: any other way there (the nav, ⌘2) starts at the top.
  // 'ask' is the channel owner's Ask AI page (the sidebar's Ask AI, ⌘J), which remembers the page it was opened from.
  function goChannel(next, focus = '') {
    if (!channelIds.includes(next) && !(next === 'ask' && channelAsk)) return;
    if (next === 'ask' && channelTab !== 'ask') setChannelLastTab(channelTab);
    setChannelFocus(typeof focus === 'string' ? focus : ''); setChannelTrendFocus(''); withViewTransition(() => setChannelTab(next));
  }
  // { key, section }: the Settings section to jump to (settings-sections.js ids; '' = the top), once per key.
  const [settingsRequest, setSettingsRequest] = useState(null);
  function openSettings(section = '') {
    if (!settingsAllowed || !guard.confirmLeave()) return;
    setSettingsRequest({ key: Date.now(), section: typeof section === 'string' ? section : '' }); // click handlers pass an event
    if (mode === 'simple') withViewTransition(() => setSimpleTab('settings'));
    else navigate('settings', {}, { confirmed: true });
  }
  function openAdminPage(id) {
    if (!adminPages.includes(id)) return;
    if (mode === 'simple') goSimple(id);
    else navigate(id);
  }
  // Simple | Advanced. Saved per person (setViewPrefs), or in the shared settings by an older main process. `confirmed`:
  // the caller already asked about unsaved edits.
  async function chooseMode(next, { confirmed = false } = {}) {
    if (!['simple', 'classic'].includes(next) || next === mode) return;
    if (!confirmed && !guard.confirmLeave()) return;
    setDrawerOpen(false);
    if (peek) { withViewTransition(() => setPeek(false)); if (next === savedMode) return; }
    if (next === savedMode) return;
    withViewTransition(() => setModeChoice(next));
    await runAction(() => (api.setViewPrefs ? api.setViewPrefs({ uiMode: next }) : api.saveSettings({ uiMode: next })));
    setModeChoice('');
  }
  // From the peek bar: make Advanced the saved layout, as choosing it in the sidebar would.
  async function keepAdvanced() {
    if (!peek) return;
    withViewTransition(() => { setModeChoice('classic'); setPeek(false); });
    await runAction(() => (api.setViewPrefs ? api.setViewPrefs({ uiMode: 'classic' }) : api.saveSettings({ uiMode: 'classic' })));
    setModeChoice('');
  }
  function toggleDataTools() {
    const next = !dataToolsOpen;
    setDataToolsChoice(next); saveDataToolsOpen(next);
  }
  // The rail (⌘\ and the collapse button): saved in the person's prefs, and on this device for older servers. A refused
  // save (a preview, an older main process) still leaves the choice in place for this window.
  function toggleRail() {
    if (narrow) return;
    const next = !rail;
    setSessionRail(next); saveRail(next);
    if (typeof api.setViewPrefs === 'function') Promise.resolve().then(() => api.setViewPrefs({ navRail: next })).catch(() => {});
  }
  // A page from the nav model (the sidebar, ⌘1–9, the palette), in whichever layout it belongs to. From Simple, an
  // Advanced page opens as a peek with the Back to Simple bar.
  function openNavItem(row) {
    if (!row) return;
    if (row.kind === 'channel') { goChannel(row.target); return; }
    if (row.kind === 'simple') { if (mode === 'simple') goSimple(row.target); return; }
    if (row.kind === 'admin') { openAdminPage(row.target); return; }
    if (row.kind === 'settings') { openSettings(); return; }
    if (mode === 'simple') { openClassicPage(row.target); return; }
    if (row.kind === 'studio') navigateStudio(row.target);
    else navigate(row.target);
  }
  // Ask AI from the sidebar and ⌘J: Simple's Ask AI page, or Advanced's drawer (pressed again, it closes).
  function toggleAsk() {
    if (mode === 'classic') { setPaletteOpen(false); setHelpOpen((open) => !open); return; }
    openAskAi('');
  }
  function openNewMenu() {
    if (narrow && mode !== 'channel') setDrawerOpen(true);
    setNewMenuKey((value) => value + 1);
  }

  // Ask AI with a question, in either layout: Simple's Ask AI tab, or Advanced's drawer. `draft` puts words in the box
  // for the person to finish (New › Quick scan, New › Picture) instead of asking them; `context` goes with the question
  // as background the person doesn't have to paste (a prompt's text from Prompts, a report under review).
  function openAskAi(text = '', { draft = '', context = '', attachments } = {}) {
    const question = String(text || '').trim();
    const start = String(draft || '');
    const background = typeof context === 'string' ? context : '';
    if (!askAllowed) return;
    if (mode === 'simple') {
      if (!simpleAllowed('ask') || (simpleTabRef.current !== 'ask' && !guard.confirmLeave())) return;
      if (question) setShellRequest({ key: Date.now(), kind: 'ask', text: question, context: background, ...(Array.isArray(attachments) ? { attachments } : {}) });
      else if (start) setShellRequest({ key: Date.now(), kind: 'ask', draft: start });
      withViewTransition(() => setSimpleTab('ask'));
      return;
    }
    if (mode === 'channel') {
      if (!channelAsk) return;
      if (question) setChannelSeed({ key: Date.now(), text: question, context: background, ...(Array.isArray(attachments) ? { attachments } : {}) });
      else if (start) setChannelSeed({ key: Date.now(), draft: start });
      goChannel('ask');
      return;
    }
    if (mode !== 'classic') return;
    if (question) setHelpSeed({ key: Date.now(), text: question, context: background, ...(Array.isArray(attachments) ? { attachments } : {}) });
    else if (start) setHelpSeed({ key: Date.now(), draft: start });
    setPaletteOpen(false); setHelpOpen(true);
  }
  // Open a report (an asset id) where each layout reads it: Simple's Reports, or the Advanced Library.
  function openReport(assetId) {
    if (!assetId) return;
    if (mode === 'simple') {
      if (!simpleAllowed('reports') || !guard.confirmLeave()) return;
      setShellRequest({ key: Date.now(), kind: 'report', assetId });
      withViewTransition(() => setSimpleTab('reports'));
      return;
    }
    if (!studioAllowed('library')) { setNotice(pageOffNotice('library')); return; }
    // Asked first even inside the Library: the new file replaces the editor.
    if (!guard.confirmLeave()) return;
    setLibraryRequest({ key: Date.now(), assetId });
    navigateStudio('library', { confirmed: true });
  }
  // A channel-asset folder (a kit's sourceKey) in the Advanced Library; Simple's Assets opens its own folders.
  function openLibraryFolder(folderKey) {
    if (!folderKey || mode !== 'classic') return;
    if (!studioAllowed('library')) { setNotice(pageOffNotice('library')); return; }
    // Inside the Library, the Library itself asks before a folder replaces the editor.
    if (!(active === 'content-studio' && studioView === 'library') && !guard.confirmLeave()) return;
    setLibraryRequest({ key: Date.now(), folderKey });
    navigateStudio('library', { confirmed: true });
  }
  // After a palette jump, bring the named card into view once its page has drawn it.
  function scrollToCard(selector, name) {
    clearTimeout(cardScrollTimer.current);
    const want = String(name || '').trim().toLowerCase();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let tries = 0;
    const look = () => {
      const node = [...document.querySelectorAll(selector)].find((row) => String(row.dataset.spotItem || row.getAttribute('aria-label') || '').trim().toLowerCase() === want);
      if (node) node.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      else if (++tries < 20) cardScrollTimer.current = setTimeout(look, 100);
    };
    cardScrollTimer.current = setTimeout(look, 60);
  }
  // A trend: Simple's Trends, or the Advanced Trend board, scrolled to its card (a card waiting for an OK, or the
  // Being written, Ready, approved and Skipped rows, which carry trends.ready-card).
  function reviewTrend({ name } = {}) {
    if (mode === 'simple') {
      if (!simpleAllowed('trends')) return;
      goSimple('trends');
      scrollToCard('[data-spot="trends.card"], [data-spot="trends.ready-card"]', name);
      return;
    }
    navigateStudio('board');
    scrollToCard('.tb-card', name);
  }
  // One prompt on the Prompts page (Ask AI's Open in Prompts, How this was made, a share link, an Inbox row), in either
  // layout. A role without the Prompt Library says so; the page itself shows a locked prompt read-only.
  function openPrompt(promptId = '', tab = '') {
    if (!adminPages.includes('prompts')) { setNotice(viewer.preview ? 'Prompts aren’t part of the role you’re previewing.' : `Prompts aren’t part of your role. Ask ${askAdmin} if you need to see one.`); return; }
    setPromptRequest({ key: Date.now(), promptId: String(promptId || ''), ...(tab ? { tab } : {}) });
    openAdminPage('prompts');
  }
  // A trend's name from its theme id (a share link or an Inbox row carries only the id), so its card can be found.
  function trendNameOf(themeId) {
    if (!themeId) return '';
    const card = classicActions.board.cards.find((row) => row.themeId === themeId);
    if (card) return card.name;
    for (const run of list(studioState.researchRuns)) { const theme = [...list(run.discoveredThemes), ...list(run.themes)].find((row) => row?.id === themeId); if (theme?.name) return theme.name; }
    return list(studioState.themes).find((row) => row.id === themeId)?.name || '';
  }
  // A trends report run (a content run with a themeId and no kit) as a link to its trend, with the research run it was
  // written for, so the card for that run is the one found (a recurring trend has cards from older runs too).
  function reportRunTrend(run) {
    const parentId = run.researchRunId || list(studioState.researchRuns).find((row) => list(row.reportRunIds).some((entry) => entry?.runId === run.id))?.id || '';
    return { kind: 'trend', id: run.themeId, page: 'trends', ...(parentId ? { runId: parentId } : {}) };
  }
  // Where a briefing card, an Inbox row or a share link leads (target = { kind: 'report'|'trend'|'folder'|'run'|'prompt'|
  // 'program'|'page', id, page }), in this layout. Access still applies: what this role can't open says so and lands nowhere, and
  // something that isn't in this workspace opens its page with a note.
  function openTarget(target) {
    if (!target?.kind) return;
    const { kind, id = '', page = '' } = target;
    if (kind === 'prompt') { openPrompt(id); return; }
    // A note's Inbox row: the report (or the channel's brief) opens with its notes panel at that note.
    if (target.noteId && id) requestNoteFocus(id, target.noteId);
    if (mode === 'channel') {
      // A trend, or a report (a share link from Reports or the Slack briefing), opens that trend's brief.
      const trends = list(channelView?.trends);
      if (kind === 'trend' || kind === 'report') {
        const match = kind === 'trend' ? trends.find((row) => row.themeId === id) : trends.find((row) => row.primaryReportId === id || list(row.reportAssets).some((asset) => asset?.id === id));
        goChannel('trends'); setChannelTrendFocus(match ? match.themeId : ''); // after goChannel, which clears it
        if (id && !match) setNotice(kind === 'report' ? 'That report isn’t on your channel’s list. It may not have been sent to your channel, or a newer brief replaced it.' : 'That trend isn’t on your channel’s list. It may not have been sent to your channel.');
        return;
      }
      // An Assets folder (a kit's sourceKey: theme:<id> or report:<assetId>) or a run lands on its group in My assets,
      // which is keyed by the trend's id, or run:<id> for a set with no trend.
      if (kind === 'folder' || kind === 'run') {
        const runs = list(channelView?.runs);
        const run = id.startsWith('report:') ? runs.find((row) => `report:${row.kit?.reportAssetId}` === id) : runs.find((row) => row.id === id);
        goChannel('assets', !id ? '' : id.startsWith('theme:') ? id.slice(6) : run ? (run.kit?.themeId || `run:${run.id}`) : id);
        return;
      }
      goChannel(channelIds.includes(page) ? page : 'trends');
      return;
    }
    if (kind === 'program') { openProgram(id); return; }
    if (kind === 'workflow') { openWorkflow(id, target.runId ? { runId: String(target.runId) } : {}); return; }
    if (kind === 'report') {
      // Simple's Reports lists neither channel assets nor pictures: a channel asset opens its set in Assets, and a picture
      // opens Assets. (Advanced's Library opens any file by id.)
      const asset = id ? list(studioState.assets).find((row) => row.id === id) : null;
      if (mode === 'simple' && asset) {
        const kitRun = list(studioState.contentRuns).find((run) => run.id === asset.runId && run.kit);
        if (kitRun) { openTarget({ kind: 'folder', id: kitRun.kit.sourceKey || '', runId: kitRun.id, page: 'assets' }); return; }
        if (['image', 'video'].includes(asset.kind)) { openTarget({ kind: 'page', page: 'assets' }); return; }
      }
      const known = Boolean(asset);
      if (known) openReport(id);
      else if (mode === 'simple') goSimple('reports');
      else navigateStudio('library');
      if (id && !known) noticeAcross('That report isn’t in this workspace. It may be in another workspace, or it was removed.');
      return;
    }
    if (kind === 'trend') {
      // A trend with its reports opens the trends report, where it can be read; one still waiting or skipped opens on
      // Trends (or the board), and a skipped one says where it is. A recurring trend keeps its id across runs, so one
      // id can have a card waiting for an OK and older cards with reports: the run asked for wins (`runId`), then the
      // card waiting for this person's OK, then the newest card with reports.
      const cards = classicActions.board.cards.filter((row) => row.themeId === id);
      const exact = target.runId ? cards.find((row) => row.runId === target.runId) : null;
      const waitingCard = can('decideResearchTheme') ? cards.find((row) => row.canDecide && row.stage === 'potential') : null;
      const card = exact || waitingCard || cards.find((row) => list(row.reportAssets).length) || cards[0] || null;
      const reportAssets = card?.stage === 'ready' || card?.stage === 'production' ? list(card.reportAssets) : [];
      const report = reportAssets.find((asset) => asset.deliverableId === 'evidence-report') || reportAssets[0];
      if (report && list(studioState.assets).some((asset) => asset.id === report.id) && (mode !== 'simple' || simpleAllowed('reports')) && (mode === 'simple' || studioAllowed('library'))) { openReport(report.id); return; }
      const name = card?.name || trendNameOf(id);
      // A quick scan's trends never reach Trends or the board; they're in the Trend tracker.
      const scan = !card && id ? list(studioState.researchRuns).find((run) => run.origin === 'quick-scan' && [...list(run.discoveredThemes), ...list(run.themes)].some((theme) => theme?.id === id)) : null;
      if (scan && name) {
        if (can('readWorkbook') && pageAllowed('sheets')) {
          if (mode === 'simple') openClassicPage('sheets', { workbookId: 'trend-tracker' });
          else navigate('sheets', { workbookId: 'trend-tracker' });
          noticeAcross(`“${name}” came from a quick scan, so it’s in the Trend tracker, not on Trends.`);
        } else noticeAcross(`“${name}” came from a quick scan. Quick-scan trends aren’t on Trends; ask Ask AI to summarize that scan.`);
        return;
      }
      reviewTrend({ name });
      // A trend skipped in a run that has finished can't be reconsidered there. When research found it again (a newer
      // card of the same name still waiting), that card is the one on screen, so nothing needs saying.
      const sameName = (row) => String(row.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase();
      const waitingAgain = card?.stage === 'passed' && !card.canDecide && classicActions.board.cards.some((row) => row.canDecide && row.stage !== 'passed' && sameName(row));
      if (id && !name) noticeAcross('That trend isn’t in this workspace. It may be in another workspace.');
      else if (card?.stage === 'passed' && card.canDecide) noticeAcross(mode === 'simple' ? `“${name}” was skipped. It’s under Skipped on Trends, if you want to reconsider it.` : `“${name}” was skipped. Show skipped trends on the board to reconsider it.`);
      else if (card?.stage === 'passed' && !waitingAgain) noticeAcross(`“${name}” was skipped in a research run that has finished, so it can’t be reconsidered there. If research finds it again, it comes back to ${mode === 'simple' ? 'Trends' : 'the Trend board'} for your OK.`);
      return;
    }
    if (kind === 'folder') {
      if (mode === 'simple') {
        if (!simpleAllowed('assets') || (simpleTabRef.current !== 'assets' && !guard.confirmLeave())) return;
        setShellRequest({ key: Date.now(), kind: 'assets', ...(id ? { folderKey: id } : {}), ...(id && target.runId ? { runId: target.runId } : {}) }); // runId: open that set in the folder
        withViewTransition(() => setSimpleTab('assets'));
      } else if (id) openLibraryFolder(id);
      else navigateStudio('library');
      return;
    }
    if (kind === 'run') {
      const research = list(studioState.researchRuns).find((row) => row.id === id);
      const made = research ? null : list(studioState.contentRuns).find((row) => row.id === id);
      if (made?.kit) { openTarget({ kind: 'folder', id: made.kit.sourceKey || '' }); return; }
      // A trends report being written belongs to its trend (Being written on Trends, or the board), not Create content.
      if (made?.themeId) { openTarget(reportRunTrend(made)); return; }
      const view = research || page === 'research' ? 'research' : 'create';
      if (mode !== 'simple') openStudioRun(view, id);
      else if (research?.status === 'awaiting-review' && simpleAllowed('trends')) goSimple('trends');
      else if (pageAllowed(view)) openClassicPage(view, id ? { runId: id } : {});
      else goSimple('home');
      return;
    }
    // A page, by its Simple id (trends, reports, assets, inbox…) or an Advanced one (research, library…).
    const tabId = { overview: 'home', board: 'trends', library: 'reports' }[page] || page;
    if (!tabId) return;
    if (tabId === 'settings') { if (settingsAllowed) openSettings(String(target.section || '')); else setNotice(pageOffNotice('settings')); return; }
    if (ADMIN_PAGES[tabId]) { if (adminPages.includes(tabId)) openAdminPage(tabId); else setNotice(pageOffNotice(tabId)); return; }
    if (mode === 'simple') { if (simpleAllowed(tabId)) goSimple(tabId); else openClassicPage(tabId); return; }
    const classic = { home: 'overview', trends: 'board', reports: 'library', assets: 'library' }[page] || page;
    if (STUDIO_VIEWS.has(classic)) navigateStudio(classic); else navigate(classic);
  }
  // "Find new trends with <program>" (the palette, in either layout): the shared action adapter (studio-actions.js)
  // confirms the estimate against the program's caps in the in-app dialog before anything is spent.
  async function startProgramResearch(programId) {
    const program = list(state.contentStudio?.programs).find((row) => row.id === programId);
    if (!program || !api.startResearchRun) return;
    if (!canRun('startResearchRun')) { setNotice(viewer.preview ? PREVIEW_TITLE : `Only an admin or an editor can start research. Ask ${askAdmin}.`); return; }
    const result = await classicActions.startResearch(program);
    if (typeof result === 'string') setNotice(result);
  }
  // Make channel assets outside Simple's Assets (the Advanced layout, its Library and Trend board, Ask AI's drawer, the
  // New menu): the asset dialog opens over the page the person is on (KitCreatorHost), and nobody's layout changes.
  // `request` is { kind: 'report', assetId, channels? } (a report, its channels pre-ticked) or nothing (choose one).
  const [kitRequest, setKitRequest] = useState(null);
  function openKitDialog(request = {}) {
    if (!can('planAssetKit') || !can('createAssetKit') || typeof api.planAssetKit !== 'function') { setNotice(viewer.preview ? 'Making channel assets isn’t part of the role you’re previewing.' : `Making channel assets isn’t part of your access. Ask ${askAdmin} if you need it.`); return; }
    const { channels, ...source } = request || {};
    setKitRequest({ key: Date.now(), ...(source.kind ? { source } : {}), ...(list(channels).length ? { channels: list(channels).map(String) } : {}) });
  }
  // Workflows and playbooks: a workflow (and run) to show on Workflows, and the playbook setup sheet, which opens over
  // the page the person is on in either layout (PlaybookSetup at the shell). No id opens Playbooks to choose one.
  const [workflowRequest, setWorkflowRequest] = useState(null);
  const [playbookRequest, setPlaybookRequest] = useState(null);
  function openPlaybook(playbookId = '') {
    if (!can('estimateWorkflow') || !pageAllowed('playbooks')) { setNotice(pageOffNotice('playbooks')); return; }
    if (playbookId) { setPlaybookRequest({ key: Date.now(), playbookId: String(playbookId) }); return; }
    if (mode === 'simple') openClassicPage('playbooks'); else navigate('playbooks');
  }
  function openWorkflow(workflowId = '', extra = {}) {
    if (mode === 'simple') openClassicPage('workflows', { workflowId, ...extra }); else navigate('workflows', { workflowId, ...extra });
  }
  // New (the sidebar's menu, ⌥⌘N and the palette's Create group): every kind of new thing, in either layout. Paid work
  // still confirms its estimate where it starts (research here, quick scans and pictures in Ask AI).
  async function createFromNav(kind, { programId = '' } = {}) {
    setPaletteOpen(false);
    const programs = list(studioState.programs).filter(inWorkspace);
    if (kind === 'research') {
      if (!canRun('startResearchRun')) { setNotice(viewer.preview ? PREVIEW_TITLE : `Only an admin or an editor can start research. Ask ${askAdmin}.`); return; }
      // One rule for every Find new trends: the program asked for, else the one this person chose last, else the newest.
      const result = await classicActions.startResearch(defaultProgram(programs, { id: programId, lastId: lastProgramId(viewer) }));
      if (typeof result === 'string') setNotice(result);
      return;
    }
    if (kind === 'quick-scan') { openAskAi('', { draft: 'Plan a quick scan on ' }); return; }
    if (kind === 'picture') {
      const imagesReady = Boolean(state.keys?.OPENAI_API_KEY) || Boolean(studioState.capabilities?.imagesConfigured);
      if (!imagesReady) { if (settingsAllowed) openSettings(); else setNotice(`Pictures are off for your team. Ask ${askAdmin} to turn them on.`); return; }
      openAskAi('', { draft: 'Create a picture of ' });
      return;
    }
    if (kind === 'assets') {
      // Over the page you're on, in either layout (Cancel leaves you there); Simple's Assets opens its own dialog.
      if (mode !== 'simple' || simpleTabRef.current !== 'assets') { openKitDialog(); return; }
      if (!simpleAllowed('assets')) return;
      setShellRequest({ key: Date.now(), kind: 'assets', creator: true });
      withViewTransition(() => setSimpleTab('assets'));
      return;
    }
    // "Content from a report" opens Create content on Use a report, with the reports to pick from.
    if (kind === 'content') { openStudioWith('create', () => setCreateRequest({ key: Date.now(), mode: 'report' })); return; }
    if (kind === 'program') { openStudioWith('research', () => setProgramRequest({ kind: 'new', key: Date.now() })); return; }
    if (kind === 'playbook') { openPlaybook(); return; }
    if (kind === 'person') { openInvite(); return; }
    if (kind === 'workspace' && newWorkspace) newWorkspace();
  }
  // People & access's Invite sheet, from New › Person, Home's setup checklist and Ask AI (`preset`: { role?, channelId?,
  // emails? }, what InviteDialog starts with). Admins only; the page itself says when invites need the browser studio.
  function openInvite(preset = {}) {
    if (!adminPages.includes('people')) { setNotice(pageOffNotice('people')); return; }
    setPeopleRequest({ kind: 'invite', key: Date.now(), ...(preset && typeof preset === 'object' && Object.keys(preset).length ? { preset } : {}) });
    openAdminPage('people');
  }
  // A research program drafted elsewhere (Ask AI): the program editor opens filled in, and nothing is saved until Save.
  function openProgramDraft(draft = {}) {
    if (!can('saveResearchProgram')) { setNotice(viewer.preview ? 'Setting up research isn’t part of the role you’re previewing.' : `Only an admin can set up research programs. Ask ${askAdmin}.`); return; }
    openStudioWith('research', () => setProgramRequest({ kind: 'draft', key: Date.now(), draft: draft && typeof draft === 'object' ? draft : {} }));
  }
  // One saved research program (Ask AI's program card, its Open button, a [[Program]] link): Research programs opens
  // with that program selected, whether the page is opening or already showing. Anyone who can see the page can open one.
  function openProgram(programId = '') {
    openStudioWith('research', programId ? () => setProgramRequest({ kind: 'open', key: Date.now(), programId: String(programId) }) : null);
  }
  // A share link for a report, trend, Assets folder or prompt (deep-links.js), copied as it's returned. '' when there is
  // no address to build it on (the Mac without a Studio web address) or nothing to link to.
  function copyLink(kind, id) {
    const link = linkFor(kind === 'folder' ? 'assets' : kind, id, { origin: linkOrigin });
    if (link) copyText(link).then((done) => setNotice(done ? LINK_COPIED : 'The link couldn’t be copied. Try again.'));
    return link;
  }
  // View as, for Ask AI (admins only, through the same path as the account menu and People's Preview as). It waits for
  // the server, so a refused preview shows under Ask AI's button instead of reading as done; false when it was cancelled.
  const viewAsFromNav = async (payload = {}) => {
    if (!realAdmin || !api.setViewAs) throw new Error('View as is for admins.');
    return viewAs({ ...(payload.memberId ? { memberId: String(payload.memberId) } : { role: String(payload.role || 'admin'), ...(payload.channelId ? { channelId: String(payload.channelId) } : {}) }) }, { wait: true });
  };
  // Stop a live run from the Working popover, behind the studio's own confirmation (the same words as Ask AI's Stop).
  async function stopLiveRun(run, title) {
    if (typeof api.cancelStudioRun !== 'function' || !canRun('cancelStudioRun')) { setNotice(viewer.preview ? PREVIEW_TITLE : `Ask ${askAdmin} to stop it.`); return; }
    const ok = await confirm({ title: `Stop “${title}”?`, lines: ['Finished work is kept, and you can try the rest later.'], confirmLabel: 'Stop', tone: 'danger' });
    if (ok) await runAction(() => api.cancelStudioRun({ runId: run.id }), 'Stopped. Finished work is kept.');
  }
  // Open where a live run shows its progress: Home or Trends in Simple, the run's page in Advanced (with that run
  // selected), a channel-asset set's own folder, My assets for owners.
  function liveRunOpener(run, kind) {
    if (mode === 'channel') return () => goChannel('assets', run.kit?.themeId || '');
    if (kind === 'kit' && run.kit?.sourceKey && (mode === 'simple' ? simpleAllowed('assets') : mode === 'classic' && studioAllowed('library'))) return () => openTarget({ kind: 'folder', id: run.kit.sourceKey, page: 'assets', runId: run.id });
    const simple = { research: run.status === 'awaiting-review' ? 'trends' : 'home', scan: 'home', kit: 'assets' }[kind];
    const classic = { research: 'research', scan: 'overview', kit: 'library', content: 'create' }[kind];
    const runId = kind === 'research' || kind === 'content' ? run.id : '';
    if (mode === 'simple' && simple && simpleAllowed(simple)) return () => goSimple(simple);
    if (mode === 'simple' && classic && pageAllowed(classic)) return () => openClassicPage(classic, runId ? { runId } : {});
    if (mode === 'classic' && classic && studioAllowed(classic)) return () => (runId ? openStudioRun(classic, runId) : navigateStudio(classic));
    return undefined;
  }
  // Ask AI "Show me" in Advanced: each step first moves to where its control lives. Sidebar spots open the drawer
  // below 860px, and spots inside Data tools open it; Settings spots open Settings; Ask AI's own spots (ask.*) open its
  // drawer, and every other step closes it; spots on a page both layouts share (Inbox, Calendar, Prompts, People) open
  // that page; spots on an Advanced page (`page`: the Library, Sheets) open that page.
  async function prepareClassicSpot(step) {
    const spot = spotFor(step?.target); if (!spot) return;
    const inSidebar = spot.id.startsWith('nav.') || String(spot.selector || '').includes('"nav.');
    if (narrow) setDrawerOpen(inSidebar);
    if (DATA_TOOL_SPOTS.has(spot.id) && !dataToolsOpen) { setDataToolsChoice(true); saveDataToolsOpen(true); }
    setHelpOpen(spot.tab === 'ask');
    if (spot.tab === 'settings' && settingsAllowed && active !== 'settings') navigate('settings');
    if (SHARED_SPOT_PAGES.has(spot.tab) && active !== spot.tab && pageAllowed(spot.tab)) navigate(spot.tab);
    if (spot.page === 'sheets') { if (pageAllowed('sheets')) navigate('sheets', spot.workbook ? { workbookId: spot.workbook } : {}); }
    else if (spot.page && STUDIO_VIEWS.has(spot.page) && !(active === 'content-studio' && studioView === spot.page)) navigateStudio(spot.page);
  }
  // Steps on Simple's tabs (home.*, reports.*, trends.*, assets.* …) don't exist here, so they are left out; with
  // nothing left, a note says where they are.
  const classicSpot = (spot) => Boolean(spot) && spot.layout !== 'simple' && (!spot.tab || spot.tab === 'ask' || (spot.tab === 'settings' && settingsAllowed) || (SHARED_SPOT_PAGES.has(spot.tab) && pageAllowed(spot.tab)));
  function showClassicTour(steps) {
    const shown = list(steps).filter((step) => classicSpot(spotFor(step?.target)));
    if (!shown.length) { setNotice('Those steps are in the Simple layout. Switch to Simple in the sidebar to see them.'); return; }
    setHelpOpen(false); setClassicTour({ steps: shown, key: Date.now() });
  }

  // View as (admins). A preview can close the report editor (a channel owner's screens) or the page itself (People &
  // access and Settings aren't a previewed role's), so ask about unsaved edits first, for every preview: an unsaved Roles
  // draft too. confirmLeave asks only when something is unsaved. Returns true at once (the account menu and People close
  // on it); with `wait`, a promise of true that rejects when the server refuses, for Ask AI.
  const expectedRole = useRef(null);
  const previewReturn = useRef(null); // where the real admin was when a preview started; Back to Admin returns there
  function viewAs(payload, { wait = false } = {}) {
    if (!api.setViewAs) return false;
    if (mode !== 'channel' && !guard.confirmLeave()) return false;
    // Only the first preview remembers the page, so switching from one preview to another still comes back to it.
    const startsPreview = !viewer.preview && payload?.role !== 'admin';
    if (startsPreview) previewReturn.current = { active, studioView, simpleTab };
    // A preview of one person (People's Preview as) lands on whatever that person's role is, so any role is expected.
    // Roles are compared by id (a custom role's base can be the same as a built-in one's).
    const realId = viewer.realRoleId || viewer.realRole || '';
    expectedRole.current = payload?.memberId ? '*' : `${realId}|${payload?.role === 'admin' ? realId : payload?.role || ''}|${payload?.channelId || ''}`;
    setDrawerOpen(false); setPeek(false);
    const done = runAction(() => api.setViewAs(payload), '', wait);
    if (!wait) return true;
    return done.then(() => true, (failure) => { expectedRole.current = null; if (startsPreview) previewReturn.current = null; throw failure; });
  }

  // Someone else changed this person's role (an admin in People, or the server's admin list): close what was open and say so.
  // Keyed on role ids, not bases: a move from Editor to a custom editor-based role (Viewer) is a change too.
  const roleKey = `${viewer.realRoleId || viewer.realRole || ''}|${viewer.roleId || viewer.role || ''}|${viewer.channelId || ''}`;
  const lastRole = useRef('');
  useEffect(() => {
    if (!state.viewer) return;
    const before = lastRole.current; lastRole.current = roleKey;
    if (!before || before === roleKey) return;
    setPaletteData({ prompts: null, people: null }); // what the palette may list follows the role
    if (expectedRole.current === '*' || expectedRole.current === roleKey) {
      expectedRole.current = null;
      // Back to Admin: the page the preview started from (People & access, usually), when the preview couldn't show it. A
      // preview that kept the page has nothing to come back to, so the admin stays wherever they went meanwhile.
      const back = previewReturn.current;
      if (back && state.viewer?.preview) {
        const kept = mode === 'simple' ? simpleAllowed(back.simpleTab) : mode === 'classic' && pageAllowed(back.active) && (back.active !== 'content-studio' || studioAllowed(back.studioView));
        if (kept) previewReturn.current = null;
      } else if (back) { previewReturn.current = null; setActive(back.active); setStudioView(back.studioView); setSimpleTab(back.simpleTab); }
      return;
    }
    expectedRole.current = null; previewReturn.current = null;
    if (!before.split('|')[1]) return; // just let in (from No access): the frame itself is the news
    setRoleEpoch((value) => value + 1); setDrawerOpen(false); setPeek(false); setPaletteOpen(false); setHelpOpen(false); setHelpSeed(null); setShellRequest(null); setChannelSeed(null); setClassicTour(null); setPromptRequest(null); setPeopleRequest(null); setRunRequest(null); setCreateRequest(null);
    const label = viewer.roleLabel || roleLabel(role);
    if (role) setNotice(`Your role changed to ${channelBase && viewer.channelName ? `${label} for ${viewer.channelName}` : label}.`);
  }, [roleKey, Boolean(state.viewer)]);
  // A page this role no longer has (Settings after a preview starts, Analytics after a demotion) falls back to its home.
  useEffect(() => {
    if (mode === 'simple' && !simpleAllowed(simpleTab)) setSimpleTab(simpleTabs[0] || 'home');
    if (mode === 'classic' && !pageAllowed(active)) setActive(api.contentCatalog ? 'content-studio' : 'dashboard');
    if (active === 'content-studio' && !studioAllowed(studioView)) setStudioView('overview');
    if (mode === 'channel' && !channelIds.includes(channelTab) && !(channelTab === 'ask' && channelAsk)) setChannelTab(channelIds[0] || 'trends');
  }, [roleKey, mode, adminPages.join('|'), settingsAllowed, simpleTabs.join('|'), channelIds.join('|'), channelAsk]);
  useEffect(() => { if (!narrow) setDrawerOpen(false); }, [narrow]);
  // A request belongs to the layout it was made in: leaving that layout drops it, so a page that mounts again later
  // (the Advanced drawer, Simple's Ask AI) never repeats an old question. Cleared before the next paint.
  useLayoutEffect(() => {
    if (mode !== 'classic') { setHelpSeed(null); setClassicTour(null); }
    if (mode !== 'simple') setShellRequest(null);
    if (mode !== 'channel') setChannelSeed(null);
  }, [mode]);
  // The Library, Research programs, Create content, Prompts, People and Sheets act on their request when they open; once
  // the person leaves the page, it is spent, so coming back later starts where the page normally does.
  const wasOn = useRef({ library: false, research: false, create: false, run: false, prompts: false, people: false, sheets: false });
  useEffect(() => {
    const studioOn = (view) => mode === 'classic' && active === 'content-studio' && studioView === view;
    const now = { library: studioOn('library'), research: studioOn('research'), create: studioOn('create'), run: studioOn('research') || studioOn('create'), prompts: mode === 'simple' ? simpleTab === 'prompts' : mode === 'classic' && active === 'prompts',
      people: mode === 'simple' ? simpleTab === 'people' : mode === 'classic' && active === 'people', sheets: mode === 'classic' && active === 'sheets' };
    if (wasOn.current.library && !now.library) setLibraryRequest(null);
    if (wasOn.current.research && !now.research) setProgramRequest(null);
    if (wasOn.current.create && !now.create) setCreateRequest(null);
    if (wasOn.current.run && !now.run) setRunRequest(null);
    if (wasOn.current.prompts && !now.prompts) setPromptRequest(null);
    if (wasOn.current.people && !now.people) setPeopleRequest(null);
    // Sheets keeps the request's key, so the next workbook asked for still counts as new.
    if (wasOn.current.sheets && !now.sheets) setSheetRequest((current) => (current.id ? { id: '', key: current.key } : current));
    wasOn.current = now;
  }, [mode, active, studioView, simpleTab]);

  function choosePlaybook(id) {
    const template = MARKETING_TEMPLATES.find(item => item.id === id);
    if (!template) return;
    if (template.sourceMode === 'comparison') navigate('compare', { templateId: id, reportPresetId: id });
    else if (template.sourceMode === 'dataset') navigate(state.datasets.length ? 'reports' : 'imports', { templateId: id, reportPresetId: id });
    else navigate('marketing-template', { templateId: id });
  }

  // Pages memoized below call the current ones.
  const openAskAiRef = useRef(openAskAi); openAskAiRef.current = openAskAi;
  const openTargetRef = useRef(openTarget); openTargetRef.current = openTarget;
  const openPromptRef = useRef(openPrompt); openPromptRef.current = openPrompt;
  const openKitDialogRef = useRef(openKitDialog); openKitDialogRef.current = openKitDialog;
  // Home's Next up in the Advanced layout, through the same shared actions (and confirmations) as Simple.
  const briefingActionsRef = useRef({});
  briefingActionsRef.current.onWriteReports = (...args) => classicActionsRef.current?.writeReports(...args);
  briefingActionsRef.current.onRetryRun = (runId) => Promise.resolve().then(() => classicActionsRef.current?.runAiAction({ kind: 'retry-run', runId })).then((result) => { if (typeof result === 'string') setNotice(result); }, (failure) => setNotice(failure?.message || 'That run couldn’t be tried again.'));
  briefingActionsRef.current.onCreate = (kind) => createFromNavRef.current(kind);
  briefingActionsRef.current.postsApi = typeof api.readTrendPosts === 'function' && can('readTrendPosts') ? api : null;
  // Home's Research programs panel: its notes, and Open full page (that program's editor on Research programs).
  briefingActionsRef.current.onNotice = (message) => setNotice(message);
  briefingActionsRef.current.onOpenProgramPage = (programId) => openStudioWith('research', () => setProgramRequest({ kind: 'edit', key: Date.now(), programId: String(programId) }));
  // Home's Yes and Skip in the Advanced layout show at once and can be taken back for a few seconds, as in Simple: the
  // shared decide() keeps the choice on screen while it saves, and Home shows that same board (classicBoard).
  const [classicBoard, setClassicBoard] = useState(null);
  const [classicUndoToast, showClassicUndo] = useToast(8000);
  const decideClassic = (card, decision, extra) => {
    const decide = classicActionsRef.current?.decide;
    if (typeof decide !== 'function') return Promise.resolve(false);
    const sent = decide(card, decision, extra);
    if (decision !== 'pending') Promise.resolve(sent).then((ok) => { if (ok) showClassicUndo(decision === 'passed' ? `Skipped “${card.name}”.` : `Approved “${card.name}”.`, { actionLabel: 'Undo', onAction: () => classicActionsRef.current?.decide(card, 'pending') }); }, () => {});
    return sent;
  };
  briefingActionsRef.current.onDecide = decideClassic;
  briefingActionsRef.current.onDecideWithNote = (card, choice) => decideClassic(card, 'approved', choice);
  briefingActionsRef.current.board = classicBoard;
  const createFromNavRef = useRef(null); createFromNavRef.current = createFromNav;
  const classicActionsRef = useRef(null);
  // A Next up row (next-steps.js) run from the palette: the same actions Home's rail takes, in this layout.
  async function runNextStep(step) {
    const act = step?.action || {};
    if (act.kind === 'open') openTarget(act.target);
    else if (act.kind === 'write-reports') { try { const result = await classicActions.writeReports(); if (typeof result === 'string') setNotice(result); } catch (failure) { setNotice(failure?.message || 'The reports couldn’t be started.'); } }
    else if (act.kind === 'retry') { try { const result = await classicActions.runAiAction({ kind: 'retry-run', runId: act.runId }); if (typeof result === 'string') setNotice(result); } catch (failure) { setNotice(failure?.message || 'That run couldn’t be tried again.'); } }
    else if (act.kind === 'make-assets') openKitDialog({ kind: 'report', assetId: act.assetId }); // over the page, in either layout
    else if (act.kind === 'copy') setNotice((await copyText(act.text)) ? act.done || 'Copied.' : 'That couldn’t be copied. Try again.');
    else if (act.kind === 'create') createFromNav(act.create);
  }
  // Palette items in either layout. An Advanced page opened from Simple is a peek, with the Back to Simple bar.
  async function runPaletteItem(item) {
    const args = item.args || {};
    if (item.action === 'nav') { openNavItem(args.row); return; }
    if (item.action === 'create') { await createFromNav(args.kind, args); return; }
    if (item.action === 'simple') { goSimple(args.tab); return; }
    if (item.action === 'settings') { openSettings(); return; }
    if (item.action === 'admin') { openAdminPage(args.view); return; }
    if (item.action === 'mode') { chooseMode(args.mode); return; }
    if (item.action === 'ask') { openAskAi(args.text); return; }
    if (item.action === 'read-report') { openReport(args.assetId); return; }
    if (item.action === 'review-trend') { reviewTrend(args); return; }
    if (item.action === 'start-research') { await startProgramResearch(args.programId); return; }
    if (item.action === 'open-folder') { openTarget({ kind: 'folder', id: args.folderKey, page: 'assets' }); return; }
    if (item.action === 'prompt') { openPrompt(args.promptId); return; }
    if (item.action === 'person') { if (!adminPages.includes('people')) { setNotice(pageOffNotice('people')); return; } setPeopleRequest({ kind: 'person', key: Date.now(), memberId: args.memberId }); openAdminPage('people'); return; }
    if (item.action === 'write-reports') { try { const result = await classicActions.writeReports(); if (typeof result === 'string') setNotice(result); } catch (failure) { setNotice(failure?.message || 'The reports couldn’t be started.'); } return; }
    if (item.action === 'copy-briefing') { const done = await copyText(briefingMarkdown(briefingData({ state, viewer, board: classicActions.board }), { origin: linkOrigin })); setNotice(done ? 'Briefing copied. Paste it into Slack.' : 'The briefing couldn’t be copied. Try again.'); return; }
    if (item.action === 'mark-inbox-read') { try { await markInboxRead(api); setNotice('Inbox marked read.'); } catch { setNotice('Marked read on this browser. The studio couldn’t save it for your other devices.'); } setInboxSeen((value) => value + 1); return; }
    if (item.action === 'next-step') { await runNextStep(args.step); return; }
    if (item.action === 'studio') { if (mode === 'simple') openClassicPage(args.view); else navigateStudio(args.view); return; }
    // "Run <workflow>…" opens Workflows with its Run now confirmation; "Workflows: <name>" opens it.
    if (item.action === 'workflow' && args.workflowId) { openWorkflow(args.workflowId, args.run ? { run: true } : {}); return; }
    if (item.action === 'navigate') {
      if (mode === 'simple') openClassicPage(args.view || 'dashboard');
      else navigate(args.view || 'dashboard', args);
    }
  }

  function renderSettings() {
    return <SettingsView
      state={state}
      busy={busy}
      meta={meta}
      role={viewer.role || 'admin'}
      setupApi={api}
      request={settingsRequest}
      onOpenPrograms={() => navigateStudio('research')}
      onSaveKey={(keyName, value) => runAction(() => api.saveKey(keyName, value), 'Credential saved.', keyName === 'OPENAI_API_KEY')}
      onClearKey={async (keyName) => { const [name, consequence] = KEY_CONSEQUENCE[keyName] || ['this credential', '']; return (await confirm({ title: `Disconnect ${name}?`, lines: [consequence], confirmLabel: 'Disconnect', tone: 'danger' })) ? runAction(() => api.clearKey(keyName), 'Credential disconnected.', keyName === 'OPENAI_API_KEY') : null; }}
      onSaveSettings={(settings) => runAction(() => api.saveSettings(settings), 'Settings saved.')}
      onTestSheetsBridge={() => runAction(() => api.testSheetsBridge(), 'Sheets bridge reachable.')}
      onArchiveAndClearSheets={(payload) => runAction(() => api.archiveAndClearSheets(payload), 'Working sheet archived and cleared.')}
      onImportWorkingSheets={() => runBackground('sheets-import', 'Importing the working sheet', () => api.importWorkingSheets(), 'Working sheet imported.')}
      onReplaySheetRun={(sheetRunId) => runBackground(`sheet-replay:${sheetRunId}`, 'Replaying the sheet run', () => api.replaySheetRun(sheetRunId), 'Sheet run replayed.')}
      onTestImages={() => api.testImageProvider()}
      onCheckAi={(request) => api.checkAi(request)}
      onCheckCodex={() => api.checkCodex()}
      onOpenDataFolder={() => runAction(() => api.openDataFolder(), 'Data folder opened.')}
      onOpenWorkspace={() => runAction(() => api.openWorkspace('default'), 'Workspace opened.')}
      mondayApi={api}
    />;
  }
  // The Studio group's pages (Prompts, Analytics, People & access), in either layout. People's Preview as passes a whole
  // setViewAs payload: { role, channelId? } (any role, custom roles included) or { memberId } (one person).
  function renderAdminPage(id) {
    if (id === 'analytics') return <AnalyticsView api={api} viewer={viewer} web={web} state={state} onFindTrends={() => openTargetRef.current({ kind: 'page', page: 'trends' })} />;
    if (id === 'people') return <PeopleView api={api} web={web} busy={busy} action={runAction} viewer={viewer} request={peopleRequest} onPreview={(payload) => (payload && typeof payload === 'object' ? viewAs(payload) : false)} />;
    if (id === 'prompts') return renderSharedPage('prompts');
    return null;
  }
  // Pages both layouts share (SHARED_PAGES): Inbox and Calendar for the team, My plan and Inbox for channel owners, and
  // Prompts. Their links go through openTarget and openPrompt (read through refs: the Advanced page is memoized).
  function renderSharedPage(id) {
    if (id === 'inbox') return <InboxView state={state} viewer={viewer} api={api} onOpenTarget={(target) => openTargetRef.current(target)} onMarkRead={() => setInboxSeen((value) => value + 1)} />;
    if (id === 'calendar') return <CalendarView state={state} viewer={viewer} api={api} mode="team" />;
    if (id === 'plan') return <ChannelPlan state={state} api={api} viewer={viewer} />;
    if (id === 'prompts' && typeof api.listPrompts === 'function') return <PromptLibrary api={api} state={state} viewer={viewer} can={can} request={promptRequest} onAsk={askAllowed ? (text, context) => openAskAiRef.current(text, { context }) : undefined} onNotice={setNotice} linkOrigin={linkOrigin} />;
    return <PagePlaceholder id={id} />;
  }
  const renderSimplePage = (id) => (id === 'settings' ? renderSettings() : SHARED_PAGES[id] && !ADMIN_PAGES[id] ? renderSharedPage(id) : renderAdminPage(id));

  const content = useMemo(() => {
    const common = { state, busy };
    if (active === 'content-studio') return <ContentStudioView state={state} api={api} busy={busy} activeView={studioView} libraryRequest={libraryRequest} runRequest={runRequest} createRequest={createRequest} onViewChange={(view) => { if (view !== studioView && !guard.confirmLeave()) return; withViewTransition(() => setStudioView(view)); }} shellNavigation={semrushShell} workspaceControlsInShell={Boolean(contentWorkspace)} programRequest={programRequest} onProgramRequestHandled={(key) => setProgramRequest((current) => (current?.key === key ? null : current))} onAsk={askAllowed ? (text, context, extra) => openAskAiRef.current(text, { context, attachments: extra?.attachments }) : undefined} linkOrigin={linkOrigin} onOpenPrompt={(promptId) => openPromptRef.current(promptId)} onMakeAssets={(request) => openKitDialogRef.current(request)} onContextChange={setClassicContext} briefingActions={briefingActionsRef.current} web={web} onOpenTarget={(target) => openTargetRef.current(target)} createWorkspaceKey={createWorkspaceKey} onWorkspaceCreationHandled={() => setCreateWorkspaceKey(0)} onNavigate={navigate} onNotice={(message) => setNotice(message)} knowledgeTab={knowledgeTab} onKnowledgeTabChange={setKnowledgeTab} renderResearchProfiles={() => <BrandContextView {...common} onSaveProfile={(profile) => runAction(() => api.saveBrandProfile(profile), '', true)} onDeleteProfile={can('deleteBrandProfile') ? (id) => runAction(() => api.deleteBrandProfile(id), '', true) : undefined} onSelectProfile={(id) => runAction(() => api.selectBrandProfile(id), '', true)} />} renderLegacyLibrary={() => <LegacyLibrary state={state} busy={busy} onOpenAsset={(assetId) => runAction(() => api.openAsset(assetId), fileNotice('Asset opened.'))} onRevealAsset={(assetId) => runAction(() => api.revealAsset(assetId), fileNotice(`Asset ${revealed}.`))} />} />;
    if (active === 'sheets') return <SheetsView api={api} state={state} initialWorkbookId={sheetRequest.id} workbookRequestKey={sheetRequest.key} onNavigate={(target, args = {}) => (target === 'research-programs' ? (args?.runId ? openTargetRef.current({ kind: 'run', id: String(args.runId), page: 'research' }) : navigateStudio('research')) : target === 'trend-board' ? navigateStudio('board') : navigate(target))} />;
    if (active === 'templates') return <TemplateLibraryView {...common} onChooseTemplate={choosePlaybook} onNavigate={navigate} />;
    if (active === 'imports') return <ImportDataView key={creation.key || 'import'} {...common} templateId={creation.templateId} reportPresetId={creation.reportPresetId} onPickFile={() => api.pickImportFile()} onPreview={(request) => api.previewImportDataset(request)} onImport={(request) => runAction(() => api.importDataset(request), '', true)} onNavigate={navigate} />;
    if (active === 'compare') return <CompareView {...common} onCompare={(request) => runAction(() => api.compareDatasets(request), '', true)} onSaveMonitor={(request) => runAction(() => api.saveMonitor(request), '', true)} onNavigate={navigate} />;
    if (active === 'search') return <SearchView {...common} onPreviewSearch={(request) => api.previewSearchSources(request)} onSearch={(request) => runBackground('search', 'Platform search', () => api.searchSources(request), '', true)} onRefreshActors={() => runAction(() => api.refreshApifyActors(), 'Apify Actors synced.', true)} onNavigate={navigate} />;
    if (active === 'chat') return <FindingsChatView {...common} selectedDatasetId={selectedDatasetId} onDatasetSelect={setSelectedDatasetId} onAskQuestion={(request) => runBackground('ask', 'Answering your question', () => api.askFindings(request), '', true)} onOpenSourceUrl={(url) => api.openSourceUrl(url)} onNavigate={navigate} onOpenAskAi={askAllowed ? () => openAskAiRef.current('') : undefined} />;
    if (active === 'marketing-template') return <MarketingTemplateView key={creation.key} templateId={creation.templateId} busy={busy} brandProfiles={state.brandProfiles} selectedBrandProfileId={state.settings.selectedBrandProfileId} onSelectBrandProfile={(id) => api.selectBrandProfile(id)} onManageProfiles={() => navigate('brands')} onOpenScrapers={() => navigate('automation')} onCancel={() => navigate('templates')} onSave={(recipe) => runAction(() => api.saveRecipe(recipe), 'Collection saved. Open Scrapers to collect pages, then Dataset reports to create the brief.', true)} />;
    if (active === 'automation') {
      return (
        <AutomationView
          {...common}
          initialTemplateId={creation.templateId}
          creationKey={creation.key}
          onSaveRecipe={(recipe) => runAction(() => api.saveRecipe(recipe), 'Scraper saved.')}
          onRunRecipe={(recipeId) => runBackground(`recipe:${recipeId}`, 'Scraper run', () => api.runRecipe(recipeId), 'Scraper run complete. New rows are in Datasets.')}
          onDeleteRecipe={can('deleteRecipe') ? (recipeId) => runAction(() => api.deleteRecipe(recipeId), 'Scraper deleted.') : undefined}
          onDiscoverApifyResource={(payload) => api.discoverApifyResource(payload)}
          onTestRecipe={(recipe) => api.testRecipe(recipe)}
          onSaveRecipeVersion={(payload) => runAction(() => api.saveRecipeVersion(payload), 'Scraper version saved.')}
          onOpenDataset={(datasetId) => navigate('datasets', { datasetId, tab: 'explorer' })}
        />
      );
    }
    if (active === 'runs') return <ActivityView {...common} onRunRecipe={(recipeId) => runBackground(`recipe:${recipeId}`, 'Scraper run', () => api.runRecipe(recipeId), 'Scraper run complete. New rows are in Datasets.')} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} onOpenStudio={(view, runId) => (runId && (view === 'research' || view === 'create') ? openTargetRef.current({ kind: 'run', id: String(runId), page: view }) : navigateStudio(view))} onCancelJob={async (jobId) => ((await confirm(CANCEL_JOB)) ? runAction(() => api.cancelJob(jobId), 'Job cancelled.') : null)} />;
    if (active === 'datasets') {
      const datasetPayload = payloadDatasetId === selectedDataset?.id ? payload : null;
      return <DatasetHub state={state} tab={datasetTab} onTabChange={setDatasetTab} selectedDataset={selectedDataset} payload={datasetPayload} payloadError={payloadError} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} onOpenSourceUrl={(url) => api.openSourceUrl(url)}
        renderExplorer={() => (
        <DatasetsView
          {...common}
          selectedDatasetId={selectedDatasetId}
          onDatasetSelect={setSelectedDatasetId}
          payload={payloadDatasetId === selectedDataset?.id ? payload : null}
          payloadError={payloadError}
          onRetryPayload={() => setPayloadAttempt((value) => value + 1)}
          onNavigate={navigate}
          onSearchEvidence={(query) => api.searchEvidence(query)}
          onAnalyze={(datasetId, kind, options = {}) => runBackground(`analyze:${datasetId}:${kind}`, 'AI analysis', () => api.analyzeDataset({ datasetId, kind, ...options }), 'AI analysis complete.')}
          onExportDataset={(datasetId, format) => runAction(() => api.exportDataset({ datasetId, format }), (result) => `Exported ${result.itemCount} rows to ${result.format.toUpperCase()}.`)}
          onExportDatasetToSheets={(datasetId) => runBackground(`sheets-export:${datasetId}`, 'Sending rows to Google Sheets', () => api.exportDatasetToSheets({ datasetId }), (result) => `Wrote ${number(result.rowCount || 0)} rows to ${result.tabName || 'Sheets'}.`)}
        />)}
        renderConversations={() => <ThreadsView {...common} payload={datasetPayload} selectedDataset={selectedDataset} onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)} onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), fileNotice('Analysis output opened.'))} onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), fileNotice(`Analysis output ${revealed}.`))} onAnalyze={(datasetId, kind) => runBackground(`analyze:${datasetId}:${kind}`, 'Conversation summary', () => api.analyzeDataset({ datasetId, kind }), 'Conversation summary complete.')} />} />;
    }
    if (active === 'reports') {
      return (
        <ReportsView
          {...common}
          initialReportPresetId={creation.reportPresetId}
          initialAnalysisId={creation.analysisId}
          onReadResearchReview={(id) => api.readResearchReview(id)}
          onSaveResearchReview={(request) => runAction(() => api.saveResearchReview(request), 'Review and actions saved.', true)}
          onExportResearchReview={(request) => runAction(() => api.exportResearchReview(request), 'Review package exported with evidence and receipt.', true)}
          onNavigate={navigate}
          selectedDatasetId={selectedDatasetId}
          onDatasetSelect={setSelectedDatasetId}
          onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)}
          onAnalyze={(datasetId, kind, options = {}) => runBackground(`analyze:${datasetId}:${kind}`, 'Dataset report', () => api.analyzeDataset({ datasetId, kind, ...options }), 'Dataset report ready.')}
          onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), fileNotice('Analysis output opened.'))}
          onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), fileNotice(`Analysis output ${revealed}.`))}
        />
      );
    }
    if (active === 'settings') return renderSettings();
    if (active === 'inbox' || active === 'calendar') return renderSharedPage(active);
    if (ADMIN_PAGES[active]) return renderAdminPage(active);
    // Automate: Playbooks and Workflows (workflows-view.jsx, playbooks-view.jsx); the setup sheet opens at the shell.
    if (active === 'workflows') return <WorkflowsView state={state} api={api} viewer={viewer} can={can} confirm={confirm} action={runAction} onOpenTarget={openTarget} onOpenPlaybooks={pageAllowed('playbooks') ? () => navigate('playbooks') : undefined} initial={workflowRequest} desktop={!web} edition={semrushShell ? 'semrush' : 'general'} settingsAllowed={settingsAllowed} />;
    if (active === 'playbooks') return <PlaybooksView state={state} api={api} viewer={viewer} can={can} confirm={confirm} action={runAction} onSetUp={(id) => openPlaybook(id)} onOpenWorkflow={(id) => navigate('workflows', { workflowId: id })} edition={semrushShell ? 'semrush' : 'general'} />;
    // Home, and where an unknown or retired page id lands.
    return <HomeView state={state} busy={busy} web={web} onNavigate={navigate} />;
  }, [workflowRequest, active, state, meta, busy, web, selectedDatasetId, payload, payloadError, selectedDataset, payloadDatasetId, creation, studioView, createWorkspaceKey, semrushShell, contentWorkspace, datasetTab, knowledgeTab, sheetRequest, libraryRequest, runRequest, createRequest, askAllowed, viewer, peopleRequest, programRequest, promptRequest, linkOrigin, inboxSeen, classicBoard, settingsRequest]);

  // The palette's items, built only while it is open: this layout's pages from the nav model (in Simple, the Advanced
  // pages too, as peeks), the Create group from the New menu, this workspace's trends, reports and programs, actions.
  function paletteEntries() {
    const iconOf = (name) => NAV_ICONS[name] || Command;
    const groupOf = (model, row) => model.groups.find((group) => group.id === row.group)?.label || '';
    const entry = (model, row, extra = {}) => ({ id: `page-${model.layout}-${row.id}`, label: `Open ${row.label}`, icon: iconOf(row.icon), group: PALETTE_GROUPS.pages, shortcut: model === nav ? row.shortcut : '',
      keywords: [groupOf(model, row), row.kind === 'admin' && 'studio admin', row.id === 'settings' && 'connections keys apify claude codex images google monday preferences'].filter(Boolean).join(' '), action: 'nav', args: { row }, ...extra });
    const pages = navPages(nav).map((row) => entry(nav, row));
    const listed = new Set(pages.map((row) => row.label));
    // From Simple, an Advanced page opens as a peek; it says so, and turns up when the person types its name. The
    // General edition's content-studio tabs aren't in its sidebar, but the palette finds them.
    const tabs = !semrushShell ? generalStudioTabs({ viewer, hasStudio: Boolean(api.contentCatalog) }).map((row) => entry(classicShape, row, { id: `studio-${row.id}`, hint: mode === 'simple' ? 'Advanced layout · Content studio' : 'Content studio', keywords: `${mode === 'simple' ? 'advanced ' : ''}content studio` })) : [];
    const peeks = mode === 'simple' ? navPages(classicShape).filter((row) => !['admin', 'settings'].includes(row.kind) && !listed.has(`Open ${row.label}`)).map((row) => entry(classicShape, row, { hint: 'Advanced layout', keywords: `advanced ${groupOf(classicShape, row)}`.trim() })) : [];
    const create = nav.actions.create.filter((row) => !row.disabled && !(row.id === 'research' && (row.programId || row.choices.length))).map((row) => ({ id: `create-${row.id}`, label: row.label, hint: row.hint, icon: iconOf(row.icon), group: PALETTE_GROUPS.create, keywords: 'new create make start', action: 'create', args: { kind: row.id, programId: row.programId || '' } }));
    const content = api.contentCatalog && state.contentStudio ? paletteContent({ studio: state.contentStudio, board: classicActions.board, canStartResearch: Boolean(api.startResearchRun) && can('startResearchRun'), canDecide: can('decideResearchTheme'), folders: mode !== 'channel' && (mode === 'simple' ? simpleAllowed('assets') : studioAllowed('library')) }) : [];
    // Next up: the same rows as Home's rail, first when nothing is typed.
    const next = api.contentCatalog && state.contentStudio ? nextSteps({ state, viewer, can, board: classicActions.board, askAdmin, origin: linkOrigin }).slice(0, 4).map((step) => ({ id: `next-${step.id}`, label: step.title, hint: step.action?.label || '', icon: ListChecks, group: PALETTE_GROUPS.next, keywords: `next up to do ${step.kind} ${step.detail || ''}`, action: 'next-step', args: { step } })) : [];
    const prompts = adminPages.includes('prompts') ? list(paletteData.prompts).map((row) => ({ id: `prompt-${row.id}`, label: `Open prompt: ${row.name || row.id}`, hint: row.version ? `Version ${row.version}` : '', icon: ScrollText, group: PALETTE_GROUPS.prompts, keywords: `prompt instructions ${row.id} ${row.stage || ''} ${row.description || ''}`, action: 'prompt', args: { promptId: row.id } })) : [];
    const people = adminPages.includes('people') ? list(paletteData.people).filter((row) => row?.id && row.name).map((row) => ({ id: `person-${row.id}`, label: `People: ${row.name}`, hint: [row.roleLabel || roleLabel(row.role), row.channelName].filter(Boolean).join(' · ') || 'People & access', icon: UserRound, group: PALETTE_GROUPS.people, keywords: `person member access role ${row.email || ''}`, action: 'person', args: { memberId: row.id } })) : [];
    const canSwitch = nav.footer.layouts.length > 1;
    const actions = [
      ...(mode === 'classic' && can('saveRecipe') ? [{ id: 'create-scraper', label: 'Create a new scraper', icon: Globe2, group: PALETTE_GROUPS.actions, keywords: 'new scraper apify actor collect', action: 'navigate', args: { view: 'automation', create: true } }] : []),
      ...(nav.actions.ask ? [{ id: 'open-ask-ai', label: 'Open Ask AI', icon: Sparkles, group: PALETTE_GROUPS.actions, shortcut: '⌘J', keywords: 'chat help question assistant', action: 'ask', args: { text: '' } }] : []),
      ...(canSwitch ? [mode === 'simple' ? { id: 'mode-classic', label: 'Switch to the Advanced layout', icon: Repeat2, group: PALETTE_GROUPS.actions, keywords: 'advanced layout mode every tool', action: 'mode', args: { mode: 'classic' } }
        : { id: 'mode-simple', label: peek ? 'Back to Simple' : 'Switch to the Simple layout', icon: Repeat2, group: PALETTE_GROUPS.actions, keywords: 'simple layout mode', action: 'mode', args: { mode: 'simple' } }] : []),
      ...(can('estimateWorkflow') && pageAllowed('workflows') ? list(state.contentStudio?.workflows).flatMap((row) => [
        ...(can('runWorkflow') && !viewer.preview ? [{ id: `run-workflow-${row.id}`, label: `Run ${row.name}…`, hint: 'Shows the cost first', icon: Workflow, group: PALETTE_GROUPS.actions, keywords: 'workflow automation run now', action: 'workflow', args: { workflowId: row.id, run: true } }] : []),
        { id: `open-workflow-${row.id}`, label: `Workflows: ${row.name}`, icon: Workflow, group: PALETTE_GROUPS.actions, keywords: 'workflow automation schedule', action: 'workflow', args: { workflowId: row.id } },
      ]) : []),
      ...(canWriteReports(can) && classicActions.approved.length ? [{ id: 'write-reports', label: `Write reports for ${classicActions.approved.length} approved ${classicActions.approved.length === 1 ? 'trend' : 'trends'}`, hint: 'Shows the cost first', icon: Sparkles, group: PALETTE_GROUPS.actions, keywords: 'write reports approved trends', action: 'write-reports' }] : []),
      ...(api.contentCatalog && state.contentStudio ? [{ id: 'copy-briefing', label: 'Copy briefing for Slack', hint: linkOrigin ? 'With links' : '', icon: ClipboardCopy, group: PALETTE_GROUPS.actions, keywords: 'slack weekly briefing copy share summary', action: 'copy-briefing' }] : []),
      ...(inboxCount > 0 && pageAllowed('inbox') ? [{ id: 'mark-inbox-read', label: 'Mark Inbox read', hint: `${inboxCount} unread`, icon: CheckCheck, group: PALETTE_GROUPS.actions, keywords: 'inbox read clear notifications', action: 'mark-inbox-read' }] : []),
    ];
    return [...next, ...pages, ...tabs, ...peeks, ...create, ...content, ...prompts, ...people, ...actions];
  }
  // Whatever was typed can always go to Ask AI, as the palette's last result.
  const paletteFallback = askAllowed && (mode === 'classic' || simpleAllowed('ask')) ? (text) => ({ id: 'ask-ai', label: `Ask AI: ${text}`, icon: Sparkles, group: PALETTE_GROUPS.ask, action: 'ask', args: { text } }) : undefined;
  // How the Advanced layout takes someone somewhere, for Ask AI's buttons and cards (studio-actions.js StudioNav).
  // Reports and channel-asset folders open in the Library; Make channel assets opens the asset dialog over the page.
  // The New menu uses the same adapter from Simple, so a page link there is a peek.
  const classicStudioNav = {
    openReport,
    openFolder: openLibraryFolder,
    makeAssets: (request) => openKitDialog(request),
    openTarget: (target) => openTarget(target),
    copyLink,
    openInvite,
    viewAs: viewAsFromNav,
    openProgramDraft,
    openTab: (tab) => (tab === 'ask' ? openAskAi('') : tab === 'settings' ? openSettings() : openHelpPage({ home: 'overview', reports: 'library', trends: 'board', assets: 'library' }[tab] || tab)),
    openPage: (page) => (mode === 'simple' ? openClassicPage(page) : openHelpPage(page)),
    openSheets: (workbookId) => navigate('sheets', workbookId ? { workbookId } : {}),
    openPrompt: (promptId) => openPrompt(promptId),
  };
  // Ask AI's buttons in the Advanced drawer, the palette's "Find new trends with …" and New › Find new trends, through
  // the same adapter as Simple (every paid step confirms its estimate in the in-app dialog). It's a hook, so it runs on
  // every render, above the early returns below; StudioApp renders ViewerContext itself, so the viewer and its checks
  // are passed in.
  const classicActions = useStudioActions({ api, state, action: runAction, viewer, can, canRun, nav: classicStudioNav, settingsAllowed, tabs: simpleTabs, web, onNotice: setNotice });
  classicActionsRef.current = classicActions;
  // The board Advanced Home shows, with Yes and Skip on it the instant they are pressed (decideClassic).
  useEffect(() => { setClassicBoard(classicActions.board); }, [classicActions.board]);
  // Ask AI announces each picture it makes, so the Library lists it while the drawer is still open over it.
  const askApi = useAnnouncingApi(api);
  const studioState = state.contentStudio || {};
  const channelView = studioState.channelView;
  const dismiss = () => { setError(''); setNotice(''); };
  const inWorkspace = (run) => !studioState.activeWorkspaceId || !run.workspaceId || run.workspaceId === studioState.activeWorkspaceId;
  // New › Workspace and the switcher's New workspace: Brand knowledge's new-workspace form, for a real admin.
  const newWorkspace = switchWorkspace && can('saveContentWorkspace') ? () => openStudioWith('knowledge', () => setCreateWorkspaceKey((value) => value + 1)) : undefined;
  // The sidebar's model for this layout, with what waits on this person: trends that need their OK (the board knows
  // decisions made a moment ago) and unread Inbox rows. ⌘1–9 walk its order.
  const nav = buildNav({ ...navBase, layout: mode, counts: { waiting: can('decideResearchTheme') ? classicActions.waiting.length : 0 }, inboxUnread: inboxCount });
  const activeNavId = mode === 'channel' ? channelTab : mode === 'simple' ? simpleTab : active === 'content-studio' ? (semrushShell ? studioView : 'content-studio') : active === 'marketing-template' ? 'templates' : active;
  keysRef.current = { mode, order: nav.order, openNavItem, settingsAllowed, openSettings, canAsk: Boolean(nav.actions.ask), toggleAsk, canRail: !narrow, toggleRail, canCreate: nav.actions.create.length > 0, openNew: openNewMenu };
  // Share links (#/report/…, #/trend/…, #/assets/…, #/prompt/…), opened once the studio has loaded and this person has a
  // role (a link opened while signed out was kept through sign-in by web/main.jsx). Someone without a role keeps the link
  // in the address bar until they're let in.
  useDeepLink((link) => { const target = deepLinkTarget(link); if (target) openTargetRef.current(target); }, { enabled: !loading && Boolean(!state.viewer || state.viewer.role) });
  // My channels (the account menu): saved per person; Assets, the asset dialog and trend cards read prefs.focusChannels.
  async function saveFocusChannels(ids) {
    const names = nav.footer.channels.filter((row) => ids.includes(row.id)).map((row) => row.short || row.name);
    await runAction(() => api.setViewPrefs({ focusChannels: ids }), names.length ? `Saved. Your channels: ${names.join(', ')}.` : 'Saved. Every channel shows for you again.', true);
  }

  // First load: nothing to show yet, and on the web this person's role isn't known, so no frame until it is.
  if (loading && !state.viewer) return <div className="studio-boot" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><p>Opening your studio…</p></div>;
  // Signed in, but not a member (or paused): no sidebar, just who to ask.
  if (state.viewer && !state.viewer.role) {
    return <ViewerContext.Provider value={viewer}><NoAccess viewer={viewer} admins={list(state.team?.admins)} canSignOut={Boolean(api.signOut)} onRetry={refresh} onSignOut={() => api.signOut?.()} /></ViewerContext.Provider>;
  }

  const backgroundLabels = Object.values(background);
  // Working: every live run, with Open (where its progress shows) and Stop, then running data jobs with Cancel. Quick
  // work with no run behind it is a plain status line; the Advanced top bar says "Working" for those too.
  const live = (row) => ACTIVE_RUN.has(row.status);
  const canStop = typeof api.cancelStudioRun === 'function' && can('cancelStudioRun');
  const stopper = (run, title) => (canStop ? () => stopLiveRun(run, title) : undefined);
  const liveRows = mode === 'channel'
    ? list(channelView?.runs).filter(live).map((run) => { const title = run.kit?.sourceTitle || run.title || 'Channel assets'; return { id: run.id, title, kindLabel: 'Channel assets', line: runLine(run), onOpen: liveRunOpener(run, 'kit'), onStop: stopper(run, title) }; })
    : [
      ...list(studioState.researchRuns).filter(inWorkspace).filter(live).map((run) => { const scan = run.origin === 'quick-scan'; const title = run.title || (scan ? 'Quick scan' : 'Research run'); return { id: run.id, title, kindLabel: scan ? 'Quick scan' : 'Research', line: runLine(run), onOpen: liveRunOpener(run, scan ? 'scan' : 'research'), onStop: stopper(run, title) }; }),
      ...list(studioState.contentRuns).filter(inWorkspace).filter(live).map((run) => {
        const kit = Boolean(run.kit); const title = (kit && run.kit.sourceTitle) || run.title || (kit ? 'Channel assets' : 'Content');
        // A trends report being written opens its trend (Being written), where Write reports started it.
        const report = !kit && Boolean(run.themeId) && (mode === 'simple' ? simpleAllowed('trends') : studioAllowed('board'));
        return { id: run.id, title, kindLabel: kit ? 'Channel assets' : run.themeId ? 'Trends report' : 'Writing', line: runLine(run), onOpen: report ? () => openTarget(reportRunTrend(run)) : liveRunOpener(run, kit ? 'kit' : 'content'), onStop: stopper(run, title) };
      }),
      ...list(state.jobs).filter(live).map((job) => ({ id: `job-${job.id}`, title: job.title || readable(job.kind) || 'Job', kindLabel: readable(job.kind), line: runLine(job), stopLabel: 'Cancel',
        onOpen: pageAllowed('runs') ? () => (mode === 'simple' ? openClassicPage('runs') : navigate('runs')) : undefined,
        onStop: job.cancellable && typeof api.cancelJob === 'function' ? async () => { if (await confirm(CANCEL_JOB)) await runAction(() => api.cancelJob(job.id), 'Job cancelled.'); } : undefined })),
    ];
  const quickWork = backgroundLabels.length === 1 ? `${backgroundLabels[0]}…` : backgroundLabels.length > 1 ? `${backgroundLabels.length} tasks running` : mode !== 'classic' && busy ? 'Working…' : '';
  const working = { label: liveRows.length ? `${new Intl.NumberFormat().format(liveRows.length)} running` : quickWork, runs: liveRows };
  const classicTitle = active === 'content-studio' ? (semrushShell ? PAGE_LABELS[studioView] || 'Home' : 'Content studio') : semrushShell && active === 'dashboard' ? 'Collection overview' : PAGE_LABELS[active] || 'Overview';
  const pageTitle = mode === 'channel' ? viewer.channelName || 'Your channel'
    : mode === 'simple' ? (navPages(nav).find((row) => row.id === simpleTab)?.label || (simpleTab === 'ask' ? 'Ask AI' : simpleTab === 'settings' ? 'Settings' : ''))
    : classicTitle;
  const signOut = web && api.signOut ? () => api.signOut() : undefined;
  // The shell's own ways, for Simple's Ask AI and Home (SimpleMode's nav and Next up). makeAssets opens the asset dialog
  // over the Simple page the person is on (KitCreatorHost), so Cancel leaves them there.
  const simpleShellNav = { copyLink, openInvite, viewAs: viewAsFromNav, openProgramDraft, create: (kind) => createFromNav(kind), makeAssets: (request) => openKitDialog(request) };
  const kitHost = mode !== 'channel' && <KitCreatorHost request={kitRequest} api={api} sources={kitSourcesFrom(classicActions.reports, list(studioState.contentRuns).filter(inWorkspace))} imagesReady={Boolean(state.keys?.OPENAI_API_KEY)} action={runAction} busy={busy} picturesOff={`Pictures are off for your team. ${askAdmin} can turn them on.`} focus={list(viewer.prefs?.focusChannels)} edition={semrushShell ? 'semrush' : 'general'} onSettings={settingsAllowed ? openSettings : undefined} onOpenFolder={(key) => openTarget({ kind: 'folder', id: key, page: 'assets' })} onDone={() => setKitRequest(null)} />;
  // The playbook setup sheet, over whatever page is open in either layout; saving lands on Workflows with it selected.
  const playbookHost = mode !== 'channel' && playbookRequest && <PlaybookSetup key={playbookRequest.key} playbookId={playbookRequest.playbookId} api={api} state={state} viewer={viewer} can={can} action={runAction} confirm={confirm} edition={semrushShell ? 'semrush' : 'general'} desktop={!web} settingsAllowed={settingsAllowed} onClose={() => setPlaybookRequest(null)} onDone={(workflowId) => openWorkflow(workflowId)} onOpenPrompts={adminPages.includes('prompts') ? () => { setPlaybookRequest(null); openAdminPage('prompts'); } : undefined} />;
  // From a Simple "Show me" step: below 860px the sidebar is a drawer, so open it for nav.* spots and close it after.
  const revealNav = (open) => { if (narrow && mode !== 'channel') setDrawerOpen(Boolean(open)); };

  const main = mode === 'channel'
    ? <main className="channel-main" key={`channel-${roleEpoch}`} data-tab={channelTab}>
      {channelTab === 'ask' && channelAsk
        ? <ChannelAskPage api={askApi} state={state} viewer={viewer} can={can} canRun={canRun} action={runAction} askAdmin={askAdmin} web={web} seed={channelSeed} lastTab={channelLastTab}
          onOpenTrend={(themeId) => { goChannel('trends'); setChannelTrendFocus(themeId || ''); }} onOpenFolder={(themeId) => goChannel('assets', themeId || '')} onOpenTab={(tab) => goChannel(tab)} />
        : channelTab === 'assets'
        ? <ChannelAssets api={api} web={web} view={channelView} viewer={viewer} busy={busy} action={runAction} cache={channelCache} onCache={(key, url) => setChannelCache((current) => ({ ...current, [key]: url }))} focusThemeId={channelFocus} />
        : SHARED_PAGES[channelTab] ? renderSharedPage(channelTab)
          : <ChannelTrends api={api} view={channelView} viewer={viewer} busy={busy} action={runAction} imagesReady={studioState.capabilities?.imagesConfigured ?? true} onOpenAssets={(themeId) => goChannel('assets', themeId || '')} onPrefs={(patch) => Promise.resolve(api.setViewPrefs?.(patch)).catch(() => null)} onToast={setNotice} linkOrigin={linkOrigin} focusThemeId={channelTrendFocus} />}
    </main>
    : mode === 'simple'
      ? <SimpleMode key={`simple-${roleEpoch}`} api={api} state={state} meta={meta} busy={busy} loading={loading} notice={notice} error={error} onDismiss={dismiss} action={runAction} background={backgroundLabels} renderPage={renderSimplePage} tab={simpleTab} onTab={goSimple} tabs={simpleTabs} settingsAllowed={settingsAllowed} onOpenClassic={openClassicPage} onNotice={setNotice} onNavSpot={revealNav} spotRoot={() => frameRef.current} shellRequest={shellRequest} onOpenSheets={(workbookId) => openClassicPage('sheets', workbookId ? { workbookId } : {})} onOpenTarget={openTarget} onOpenPrompt={openPrompt} linkOrigin={linkOrigin} shellNav={simpleShellNav} />
      : <main className="workspace" key={`classic-${roleEpoch}`}>
        <Header title={classicTitle} workspaceName={contentWorkspace?.name || (web ? 'Shared studio' : 'Workspace')} busy={busy} background={backgroundLabels} onRefresh={() => runAction(refresh)} />
        <div className={`content${active === 'sheets' ? ' content-fill' : active === 'chat' ? ' content-fit' : ''}`} ref={contentRef}>
          {(error || notice) && <div className="feedback" onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}><StatusBanner error={error} notice={notice} /><Button className="ghost icon-button" aria-label="Dismiss notification" onClick={dismiss}><X size={16} /></Button></div>}
          {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><h2>Opening your workspace</h2><p>Loading your research, sheets and reports.</p></div> : <ErrorBoundary page key={active} resetKey={`${active}:${studioView}`}>{content}</ErrorBoundary>}
        </div>
        {askAllowed && <HelpAssistant api={askApi} open={helpOpen} imagesReady={Boolean(state.keys?.OPENAI_API_KEY)} copy={settingsAllowed ? {} : { noPictures: `Pictures are off for your team. ${askAdmin} can turn them on.` }} onClose={() => setHelpOpen(false)} page={{ id: active === 'content-studio' ? studioView : active, label: classicTitle || '', layout: 'classic', ...(active === 'content-studio' ? Object.fromEntries(['report', 'folder', 'run', 'trend'].filter((key) => classicContext[key]).map((key) => [key, String(classicContext[key]).slice(0, 160)])) : {}) }} onOpenPage={openHelpPage} onOpenSettings={settingsAllowed ? () => navigate('settings') : undefined} seed={helpSeed} state={state} nav={classicStudioNav} onAction={classicActions.runAiAction} onShow={showClassicTour} />}
      </main>;

  // One frame for every layout and role: the sidebar is never remounted, only the main column changes, so focus stays
  // on the control just pressed (the layout switch, View as) while the page beside it changes.
  return <ViewerContext.Provider value={viewer}><UnsavedContext.Provider value={guard}>
    <div ref={frameRef} className={`app-shell studio-frame${web ? '' : ' is-desktop'}`} data-platform={isMac() ? 'mac' : 'other'} data-edition={semrushShell ? 'semrush' : 'general'} data-mode={mode} data-rail={rail ? '' : undefined}>
      <StudioSidebar edition={semrushShell ? 'semrush' : 'general'} meta={meta} web={web} viewer={viewer} nav={nav} activeId={activeNavId} mode={mode} busy={busy} workspaces={contentWorkspaces} activeWorkspaceId={contentWorkspace?.id || ''}
        rail={rail} onToggleRail={toggleRail} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)}
        onNavigate={openNavItem} onCreate={createFromNav} onSearch={() => setPaletteOpen(true)} onAsk={toggleAsk} askCurrent={(mode === 'simple' && simpleTab === 'ask') || (mode === 'channel' && channelTab === 'ask')} askExpanded={mode === 'classic' && helpOpen} onToggleDataTools={toggleDataTools}
        onSelectWorkspace={switchWorkspace} onNewWorkspace={newWorkspace} singleWorkspace={singleWorkspace} onViewAs={api.setViewAs && realAdmin ? viewAs : undefined} onMode={chooseMode} onSignOut={signOut}
        working={working} onSaveFocusChannels={typeof api.setViewPrefs === 'function' ? saveFocusChannels : undefined} newMenuKey={newMenuKey} />
      <div className="studio-main">
        <StudioTopBar title={pageTitle} working={working} mode={mode} drawerOpen={drawerOpen} onMenu={() => setDrawerOpen((open) => !open)} channelName={viewer.channelName || ''} web={web} onSignOut={signOut} />
        <PreviewBanner viewer={viewer} busy={busy} onBack={api.setViewAs ? () => viewAs({ role: 'admin' }) : undefined} />
        {peek && mode === 'classic' && <div className="studio-peek-bar" role="region" aria-label="Advanced page"><p>You’re looking at an Advanced page. Your layout is still Simple.</p><button type="button" className="studio-peek-keep" disabled={busy} onClick={keepAdvanced}>Keep Advanced</button><button type="button" className="studio-peek-back" data-spot="top.back-to-simple" onClick={() => chooseMode('simple')}><ArrowLeft size={14} aria-hidden="true" />Back to Simple</button></div>}
        {main}
        {mode !== 'channel' && <CommandPalette open={paletteOpen} items={paletteOpen ? paletteEntries() : []} fallback={paletteFallback} limit={{ idle: 6, search: 8 }} onClose={() => setPaletteOpen(false)} onRun={runPaletteItem} />}
        {mode === 'classic' && classicTour && !loading && <Spotlight key={classicTour.key} steps={classicTour.steps} onPrepare={prepareClassicSpot} onClose={() => { setClassicTour(null); if (narrow) setDrawerOpen(false); }} onBackToChat={() => { setClassicTour(null); if (narrow) setDrawerOpen(false); setHelpOpen(true); }} />}
        {mode === 'channel' && (error || notice) && <div className={`studio-toast${error ? ' error' : ''}`} role={error ? 'alert' : 'status'} onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}><span>{error || notice}</span><button type="button" className="studio-toast-close" aria-label="Dismiss" onClick={dismiss}><X size={15} aria-hidden="true" /></button></div>}
        {mode === 'channel' && <ChannelBottomNav items={[...navPages(nav), ...(nav.actions.ask ? [{ id: 'ask', label: nav.actions.ask.label, icon: nav.actions.ask.icon, spot: nav.actions.ask.spot }] : [])]} active={channelTab} onNavigate={goChannel} />}
        {mode === 'classic' && classicUndoToast}
        {kitHost}
        {playbookHost}
      </div>
    </div>
  </UnsavedContext.Provider></ViewerContext.Provider>;
}
