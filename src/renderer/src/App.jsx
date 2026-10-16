import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, BookOpen, ChevronDown, ChevronRight, Database, FileText, FolderOpen, Globe2, Home, Images, Layers3, LayoutGrid, LoaderCircle, MessageSquare, RefreshCw, Search, Settings2, Sheet, SlidersHorizontal, Sparkles, SquareKanban, PlugZap, TrendingUp, Users, X } from 'lucide-react';
import { AutomationView } from './automation-view.jsx';
import { DatasetsView, ReportsView } from './dataset-report-views.jsx';
import { CommandPalette, MissionCommandCenter } from './mission-command.jsx';
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
import { SheetsView } from './sheets-view.jsx';
import { SIMPLE_TABS, SimpleMode } from './simple-mode.jsx';
import { ChannelBottomNav, SidebarNav, StudioSidebar, StudioTopBar } from './studio-sidebar.jsx';
import { NoAccess, PreviewBanner, useNarrow } from './role-screens.jsx';
import { ChannelAssets, ChannelTrends } from './channel-owner.jsx';
import { AnalyticsView } from './analytics-view.jsx';
import { PeopleView } from './people-view.jsx';
import { UnsavedContext, createUnsavedGuard } from './asset-editor.jsx';
import { LOCAL_ADMIN_FALLBACK, PREVIEW_TITLE, ViewerContext, adminNames, can as canCall, canRun as canRunCall, roleLabel } from './viewer.js';
import { Badge, Button, StatusBanner, datasetLabel, number, short, statusTone, withViewTransition } from './ui.jsx';
import './studio-frame.css';

// What disconnecting each credential stops, so the confirmation says what is at stake.
const KEY_CONSEQUENCE = {
  APIFY_API_TOKEN: ['your Apify token', 'Scrapers and research collection stop until you reconnect it.'],
  ANTHROPIC_API_KEY: ['the Anthropic API key', 'Research and drafts use the Claude app instead, if it is installed and signed in.'],
  OPENAI_API_KEY: ['the image generation key', 'New visuals can’t be generated until you add it again.'],
  GOOGLE_SHEETS_WEBHOOK_URL: ['the Google Sheets bridge', 'Sending rows to Sheets and pulling tabs stop until you add it again.'],
  GOOGLE_DOCS_ACCESS_TOKEN: ['Google Docs access', 'Importing Google Docs and publishing to Drive stop until you reconnect.'],
  MONDAY_API_TOKEN: ['Monday.com', 'Trend board syncing stops until you reconnect.'],
};
const confirmCancel = () => window.confirm('Cancel this job? Anything it already finished is kept.');

const NAV = [
  { id: 'content-studio', label: 'Content studio', icon: Sparkles, group: 'Workspace' },
  { id: 'dashboard', label: 'Overview', icon: Home, group: 'Workspace' },
  { id: 'sheets', label: 'Sheets', icon: Sheet, group: 'Workspace' },
  { id: 'templates', label: 'Playbooks', icon: LayoutGrid, group: 'Workspace' },
  { id: 'search', label: 'Search platforms', icon: Search, group: 'Workspace' },
  { id: 'chat', label: 'Chat with findings', icon: MessageSquare, group: 'Workspace' },
  { id: 'automation', label: 'Scrapers', icon: Globe2, group: 'Workspace' },
  { id: 'datasets', label: 'Datasets', icon: Database, group: 'Workspace' },
  { id: 'reports', label: 'AI reports', icon: Sparkles, group: 'Workspace' },
  { id: 'runs', label: 'Activity', icon: Activity, group: 'Workspace' },
  { id: 'imports', label: 'Import research', icon: Database, group: 'More tools' },
  { id: 'compare', label: 'Compare snapshots', icon: Layers3, group: 'More tools' },
  { id: 'missions', label: 'Workflows', icon: SlidersHorizontal, group: 'More tools' },
  { id: 'settings', label: 'Settings', icon: Settings2, group: 'Preferences' },
];
// Pages folded into a better home. Old links (palette, saved actions, other views) still land somewhere useful.
const DATASET_TAB_FOR = { signals: 'signals', threads: 'conversations', clusters: 'topics', competitive: 'coverage' };
const STUDIO_HOME_FOR = { kanban: 'board', calendar: 'board', assets: 'library', brands: 'knowledge' };
const STUDIO_NAV = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'research', label: 'Research programs', icon: Search },
  { id: 'sheets', label: 'Sheets', icon: Sheet, appView: 'sheets' },
  { id: 'board', label: 'Trend board', icon: SquareKanban },
  { id: 'create', label: 'Create content', icon: FileText },
  { id: 'library', label: 'Library', icon: FolderOpen },
  { id: 'knowledge', label: 'Brand knowledge', icon: BookOpen },
];
// Admin pages, in both layouts. Each shows only for an admin whose studio offers its method.
const ADMIN_PAGES = { analytics: { label: 'Analytics', icon: BarChart3, method: 'getTrendAnalytics' }, people: { label: 'People & roles', icon: Users, method: 'getTeam' } };
const CHANNEL_TABS = [{ id: 'trends', label: 'Trends', icon: TrendingUp }, { id: 'assets', label: 'My assets', icon: Images }];
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
  v5: {
    missions: [],
    activeMissionId: '',
    jobs: [],
    missionPresets: [],
    evidenceSummary: { total: 0, datasets: {}, sample: [] },
    datasetProfiles: [],
    observability: {},
    release: {},
    commandPalette: [],
    schedules: {},
  },
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

  render() {
    if (this.state.error) {
      // A page-level failure keeps the sidebar alive; only a shell failure replaces the window.
      return (
        <div className="app-fallback" role="alert">
          <strong>{this.props.page ? 'This page hit a problem.' : 'Scraper Studio hit a problem.'}</strong>
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

function AdvancedView(props) {
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState(null);
  const [plannedCommand, setPlannedCommand] = useState('');
  const datasetId = props.selectedDataset?.id || '';
  useEffect(() => { setPreview(null); setPlannedCommand(''); }, [datasetId]);
  async function previewPlan(event) {
    event.preventDefault();
    const result = await props.onPlanIntent(command);
    if (result) { setPreview(result); setPlannedCommand(command); }
  }
  const examples = ['Make a lead sheet from this dataset', 'Summarize the top complaints and requests', 'Find the most engaged authors to follow up with', 'Write a research brief for the marketing team'];
  return <section className="ws advanced-workflows">
    <header className="ws-page-head"><div><span className="ws-eyebrow">Plan before you run</span><h2>Workflows</h2><p>Describe an outcome in plain words. You’ll see every step and anything missing before a single collection or AI request runs.</p></div></header>
    <div className="ws-two-col">
      <section className="ws-card workflow-planner"><h3>What would you like to make?</h3>
        <form onSubmit={previewPlan} className="ws-stack"><label htmlFor="workflow-dataset" className="ws-field">Use dataset<select id="workflow-dataset" value={datasetId} onChange={(event) => props.onNavigate('missions', { datasetId: event.target.value })}>{!datasetId && <option value="">No dataset collected yet</option>}{props.state.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{datasetLabel(dataset)}</option>)}</select></label>
          <label htmlFor="workflow-goal" className="ws-field">Your goal<textarea id="workflow-goal" rows={3} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="For example: make a lead sheet from this dataset" /></label>
          <div className="ws-suggestions" aria-label="Example goals">{examples.map((example) => <button key={example} type="button" className="ws-suggestion" onClick={() => setCommand(example)}>{example}</button>)}</div>
          <div className="ws-head-actions"><Button type="submit" disabled={props.busy || !command.trim()}><Sparkles size={14} aria-hidden="true" />Preview steps</Button><Button type="button" className="ghost" disabled={props.busy || !preview?.canRun || plannedCommand !== command} onClick={() => props.onRunIntent(command)}>Run reviewed plan</Button></div>
          {preview && plannedCommand !== command && <p className="ws-hint">You changed the goal. Preview again before running.</p>}
        </form>
      </section>
      <section className="ws-card workflow-preview-card" aria-live="polite">{preview ? <><div className="ws-card-head"><h3>{preview.intent}</h3><span className="ws-chip">{preview.canRun ? 'Ready to run' : 'Needs input'}</span></div><ol className="ws-steps">{(preview.steps || []).map((step) => <li key={step.id}><strong>{step.label}</strong><p>{step.why}</p></li>)}</ol>{(preview.missing || []).map((item) => <div key={item} className="ws-callout attention">{item}</div>)}</> : <div className="ws-plan-empty"><Sparkles size={20} aria-hidden="true" /><h3>Your plan appears here</h3><p className="ws-hint">Each step says what it does and why. Nothing runs until you choose Run reviewed plan.</p></div>}</section>
    </div>
    <details className="ws-card mission-details"><summary>Scheduled workflows & advanced controls</summary><MissionCommandCenter {...props} /></details>
  </section>;
}
export function ActionQueue({ actions, busy, onRunAction, onNavigate }) {
  if (!actions?.length) return null;
  return (
    <div className="action-queue">
      <div>
        <strong>Next best actions</strong>
        <small>Ranked from setup, data quality, and Codex output state.</small>
      </div>
      {actions.slice(0, 4).map((item) => {
        const runnable = item.action && item.action !== 'navigate';
        return (
          <button
            type="button"
            className="action-row"
            disabled={busy}
            key={item.id}
            onClick={() => (runnable ? onRunAction(item) : onNavigate(item.view, item.args || {}))}
          >
            <span className="action-copy">
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </span>
            <Badge tone={runnable ? 'running' : 'neutral'}>{runnable ? 'Run' : 'Open'}</Badge>
          </button>
        );
      })}
    </div>
  );
}

function JobTray({ jobs, busy, onCancelJob }) {
  if (!jobs.length) return null;
  return (
    <div className="job-tray" aria-live="polite">
      {jobs.map((job) => (
        <div className="job-pill" key={job.id}>
          <Badge tone={statusTone(job.status)}>{job.kind}</Badge>
          <span>{short(job.title || job.id, 52)}</span>
          {job.cancellable && <Button className="ghost danger" onClick={() => onCancelJob(job.id)}>Cancel</Button>}
        </div>
      ))}
    </div>
  );
}

function Header({ active, title, busy, background = [], state, onRefresh, onOpenPalette, onAskAi, askAiOpen = false }) {
  const item = NAV.find((nav) => nav.id === active);
  const working = busy || background.length > 0;
  return <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} aria-hidden="true" /><h1>{title || item?.label || 'Overview'}</h1></div><div className="topbar-right">{onAskAi && <Button className="ask-ai-button" aria-expanded={askAiOpen} aria-controls="help-drawer" title="Ask AI about this app (⌘J)" onClick={onAskAi}><Sparkles size={15} aria-hidden="true" /><span>Ask AI</span><kbd>⌘ J</kbd></Button>}<Button className="search-command ghost" onClick={onOpenPalette}><Search size={16} /><span>Search or jump to…</span><kbd>⌘ K</kbd></Button>{working && <span className="working-status" role="status" title={background.join('\n') || undefined}><LoaderCircle className="spin" size={14} aria-hidden="true" />{background.length === 1 && !busy ? `${background[0]}…` : background.length > 1 ? `${background.length} tasks running` : 'Working'}</span>}<Button className={`ghost icon-button ${busy ? 'is-working' : ''}`} aria-label="Refresh workspace" title="Refresh workspace" disabled={busy} onClick={onRefresh}><RefreshCw size={16} /></Button></div></header>;
}
export default function App() {
  return <ErrorBoundary>{window.apifyStudio ? <StudioApp api={window.apifyStudio} /> : <ApiUnavailable />}</ErrorBoundary>;
}

function StudioApp({ api }) {

  const [meta, setMeta] = useState(null);
  // The browser studio runs on a server: "open" and "reveal" become downloads there.
  const web = meta?.runtime === 'web';
  const fileNotice = (desktopText) => (web ? 'Download started.' : desktopText);
  const [state, setState] = useState(EMPTY_STATE);
  // Who is looking, as the server projected it. Old mocks and the Mac before its first push act as the local admin.
  const viewer = state.viewer || LOCAL_ADMIN_FALLBACK;
  const can = useCallback((method) => canCall(viewer, method), [viewer]); // shown: in a preview, the previewed role's controls
  const canRun = useCallback((method) => canRunCall(viewer, method), [viewer]); // taken by the server now
  const hiddenPages = useMemo(() => new Set(list(viewer.hiddenPages)), [viewer]);
  const role = viewer.role;
  const realAdmin = (viewer.realRole || viewer.role) === 'admin';
  const settingsAllowed = can('saveSettings') && !hiddenPages.has('settings');
  const askAllowed = Boolean(api.askHelp) && can('askHelp');
  const askAdmin = adminNames(state, 'an admin');
  const guard = useMemo(() => createUnsavedGuard(), []); // unsaved report edits, asked about before any navigation
  const [active, setActive] = useState(api.contentCatalog ? 'content-studio' : 'dashboard');
  const [studioView, setStudioView] = useState('overview');
  const [createWorkspaceKey, setCreateWorkspaceKey] = useState(0);
  const contentWorkspaces = list(state.contentStudio?.workspaces);
  const contentWorkspace = contentWorkspaces.find(item => item.id === state.contentStudio?.activeWorkspaceId);
  const semrushShell = contentWorkspace?.editionId === 'semrush';
  // Only a real admin switches the workspace everyone uses; the sidebar turns the picker off while previewing.
  const switchWorkspace = contentWorkspace && api.selectContentWorkspace && realAdmin ? (id) => { if (guard.confirmLeave()) runAction(() => api.selectContentWorkspace(id)); } : undefined;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingActions, setPendingActions] = useState(0);
  const busy = pendingActions > 0;
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [datasetTab, setDatasetTab] = useState('explorer');
  const [knowledgeTab, setKnowledgeTab] = useState('workspace');
  const [creation, setCreation] = useState({ key: null, templateId: '' });
  const contentRef = useRef(null);
  const frameRef = useRef(null);
  const [payloadDatasetId, setPayloadDatasetId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Simple is the default layout. "peek" opens one Advanced page from Simple for this session, without saving a preference.
  const [peek, setPeek] = useState(false);
  const [modeChoice, setModeChoice] = useState(''); // the layout just chosen, shown before the saved preference comes back
  const [simpleTab, setSimpleTab] = useState('home');
  const [simpleCounts, setSimpleCounts] = useState({});
  const [channelTab, setChannelTab] = useState('trends');
  const [channelFocus, setChannelFocus] = useState('');
  const [channelCache, setChannelCache] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [roleEpoch, setRoleEpoch] = useState(0); // bumps when someone else changes this person's role, to close open sheets
  const narrow = useNarrow();
  const [payload, setPayload] = useState(null);
  const [sheetRequest, setSheetRequest] = useState({ id: '', key: 0 });
  const [payloadError, setPayloadError] = useState('');
  const [payloadAttempt, setPayloadAttempt] = useState(0);
  const [background, setBackground] = useState({});
  const backgroundRef = useRef({});
  const datasetKey = state.datasets.map((dataset) => `${dataset.id}:${dataset.itemCount}:${dataset.createdAt}`).join('|');

  // What this role may open: the Simple tabs, the admin pages, and Advanced pages not hidden from it.
  const navMain = Array.isArray(viewer.nav?.main) ? viewer.nav.main : null;
  const simpleTabs = SIMPLE_TABS.filter((tab) => (!navMain || navMain.includes(tab.id)) && !hiddenPages.has(tab.id));
  const navAdmin = Array.isArray(viewer.nav?.admin) ? viewer.nav.admin : Object.keys(ADMIN_PAGES);
  const adminPages = Object.keys(ADMIN_PAGES).filter((id) => navAdmin.includes(id) && !hiddenPages.has(id) && typeof api[ADMIN_PAGES[id].method] === 'function' && can(ADMIN_PAGES[id].method));
  const simpleAllowed = (id) => simpleTabs.some((tab) => tab.id === id) || (id === 'settings' && settingsAllowed) || adminPages.includes(id);
  const studioAllowed = (view) => !hiddenPages.has(view);
  function pageAllowed(view) {
    const studio = STUDIO_HOME_FOR[view] || (STUDIO_NAV.some((item) => item.id === view && !item.appView) ? view : '');
    if (studio) return studioAllowed(studio);
    return !hiddenPages.has(view) && (view !== 'settings' || settingsAllowed) && (!ADMIN_PAGES[view] || adminPages.includes(view));
  }

  // The layout: channel owners have their own; otherwise this person's saved choice, or Advanced while peeking.
  const modes = list(viewer.modes).length ? viewer.modes : ['simple', 'classic'];
  const savedMode = viewer.prefs?.uiMode || state.settings?.uiMode || 'simple';
  const wantedMode = modeChoice || (peek ? 'classic' : savedMode);
  const mode = role === 'channel' ? 'channel' : modes.includes(wantedMode) ? wantedMode : 'simple';

  async function refresh() {
    const [nextMeta, nextState] = await Promise.all([api.appMeta(), api.state()]);
    setMeta(nextMeta);
    setState({ ...EMPTY_STATE, ...nextState });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message || String(err))).finally(() => setLoading(false));
    return api.onStateChanged((next) => setState({ ...EMPTY_STATE, ...next }));
  }, []);

  // ⌘K and ⌘J belong to the Advanced layout; ⌘, opens Settings for admins in either layout; channel owners get ⌘1–2.
  const keysRef = useRef({});
  keysRef.current = { mode, settingsAllowed, askAllowed, openSettings, channelTabs: CHANNEL_TABS.map((tab) => tab.id), goChannel };
  useEffect(() => {
    function onKeyDown(event) {
      const keys = keysRef.current;
      if (event.key === 'Escape') setPaletteOpen(false);
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k' && keys.mode === 'classic') { event.preventDefault(); setPaletteOpen((open) => !open); }
      if (key === 'j' && keys.mode === 'classic' && keys.askAllowed) { event.preventDefault(); setPaletteOpen(false); setHelpOpen((open) => !open); }
      if (event.key === ',' && keys.settingsAllowed && keys.mode !== 'channel') { event.preventDefault(); setPaletteOpen(false); keys.openSettings(); }
      if (keys.mode === 'channel' && !event.shiftKey && /^[1-9]$/.test(event.key) && keys.channelTabs[Number(event.key) - 1]) { event.preventDefault(); keys.goChannel(keys.channelTabs[Number(event.key) - 1]); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => { contentRef.current?.scrollTo?.(0, 0); }, [active, studioView]);

  // Notices leave on their own, but never while the pointer is resting on them.
  const [noticeHeld, setNoticeHeld] = useState(false);
  useEffect(() => {
    if (!notice && !error) setNoticeHeld(false); // the banner unmounted under the pointer, so no mouseleave arrives
    if (!notice || noticeHeld) return;
    const timeout = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timeout);
  }, [notice, error, noticeHeld]);

  useEffect(() => {
    let cancelled = false;
    const datasetId = state.datasets.find((item) => item.id === selectedDatasetId)?.id || state.datasets[0]?.id || '';
    setPayload(null);
    setPayloadDatasetId('');
    setPayloadError('');
    if (!datasetId || !api.readDataset || !can('readDataset')) {
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
  }, [selectedDatasetId, datasetKey, payloadAttempt]);

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

  function navigate(view, args = {}) {
    withViewTransition(() => applyNavigation(view, args));
  }

  function applyNavigation(view, args = {}) {
    setNotice('');
    setError('');
    // Pages this role can't open (Settings for an editor, an old link to Brand knowledge) say so instead of opening.
    if (!pageAllowed(view)) { setNotice(view === 'settings' ? `Settings are for admins. Ask ${askAdmin} if something needs changing.` : 'Only an admin can open that page.'); return; }
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
    const nextView = (view === 'marketing-template' || ADMIN_PAGES[view] || NAV.some((item) => item.id === view)) ? view : 'dashboard';
    if (args.create || args.templateId || args.reportPresetId || args.analysisId) setCreation((current) => ({ key: (current.key || 0) + 1, templateId: args.templateId || '', reportPresetId: args.reportPresetId || '', analysisId: args.analysisId || '' }));
    else if (['reports', 'imports'].includes(nextView)) setCreation({ key: null, templateId: '', reportPresetId: '', analysisId: '' });
    else if (nextView === 'automation') setCreation({ key: null, templateId: '' });
    if (NAV.find((item) => item.id === nextView)?.group === 'More tools' || (semrushShell && !['content-studio', 'settings', 'sheets', ...Object.keys(ADMIN_PAGES)].includes(nextView))) setMoreOpen(true);
    setActive(nextView);
  }

  // Ask AI's "Open" buttons name a studio view (Research programs, Library…) or an app page (Sheets, Settings…).
  function openHelpPage(page) {
    if (STUDIO_NAV.some((item) => item.id === page && !item.appView)) navigateStudio(page);
    else navigate(page);
  }

  function navigateStudio(view) {
    if (!studioAllowed(view)) { setNotice('Only an admin can open that page.'); return; }
    withViewTransition(() => {
      setStudioView(view);
      applyNavigation('content-studio');
    });
  }

  // From Simple: open one Advanced page (Full board, See why, research setup, Ask AI links) without saving a layout.
  function openClassicPage(view) {
    if (!pageAllowed(view)) { setNotice(view === 'settings' ? `Settings are for admins. Ask ${askAdmin} if something needs changing.` : 'Only an admin can open that page.'); return; }
    if (!guard.confirmLeave()) return;
    setPeek(true); setDrawerOpen(false);
    if (STUDIO_NAV.some((item) => item.id === view && !item.appView)) navigateStudio(view);
    else navigate(view);
  }
  // Simple's tabs, the sidebar and ⌘1–5 all come here, so unsaved report edits are asked about once.
  const simpleTabRef = useRef(simpleTab); simpleTabRef.current = simpleTab;
  function goSimple(next) {
    if (!simpleAllowed(next)) return;
    if (next !== simpleTabRef.current && !guard.confirmLeave()) return;
    withViewTransition(() => setSimpleTab(next));
  }
  // `focus` is a trend to jump to in My assets, once: any other way there (the nav, ⌘2) starts at the top.
  function goChannel(next, focus = '') { if (!CHANNEL_TABS.some((tab) => tab.id === next)) return; setChannelFocus(typeof focus === 'string' ? focus : ''); withViewTransition(() => setChannelTab(next)); }
  function openSettings() {
    if (!settingsAllowed || !guard.confirmLeave()) return;
    if (mode === 'simple') withViewTransition(() => setSimpleTab('settings'));
    else navigate('settings');
  }
  function openAdminPage(id) {
    if (!adminPages.includes(id)) return;
    if (mode === 'simple') goSimple(id);
    else navigate(id);
  }
  // Simple | Advanced. Saved per person (setViewPrefs), or in the shared settings by an older main process.
  async function chooseMode(next) {
    if (!['simple', 'classic'].includes(next) || next === mode) return;
    if (!guard.confirmLeave()) return;
    setDrawerOpen(false);
    if (peek) { withViewTransition(() => setPeek(false)); if (next === savedMode) return; }
    if (next === savedMode) return;
    withViewTransition(() => setModeChoice(next));
    await runAction(() => (api.setViewPrefs ? api.setViewPrefs({ uiMode: next }) : api.saveSettings({ uiMode: next })));
    setModeChoice('');
  }
  // View as (admins). Leaving for a channel owner's screens closes the report editor, so ask about unsaved edits first.
  const expectedRole = useRef(null);
  function viewAs(payload) {
    if (!api.setViewAs) return false;
    if (payload?.role === 'channel' && mode !== 'channel' && !guard.confirmLeave()) return false;
    expectedRole.current = `${viewer.realRole || ''}|${payload?.role === 'admin' ? viewer.realRole || '' : payload?.role || ''}|${payload?.role === 'channel' ? payload.channelId || '' : ''}`;
    setDrawerOpen(false); setPeek(false);
    runAction(() => api.setViewAs(payload));
    return true;
  }

  // Someone else changed this person's role (an admin in People, or the server's admin list): close what was open and say so.
  const roleKey = `${viewer.realRole || ''}|${viewer.role || ''}|${viewer.channelId || ''}`;
  const lastRole = useRef('');
  useEffect(() => {
    if (!state.viewer) return;
    const before = lastRole.current; lastRole.current = roleKey;
    if (!before || before === roleKey) return;
    if (expectedRole.current === roleKey) { expectedRole.current = null; return; }
    expectedRole.current = null;
    if (!before.split('|')[1]) return; // just let in (from No access): the frame itself is the news
    setRoleEpoch((value) => value + 1); setDrawerOpen(false); setPeek(false); setPaletteOpen(false); setHelpOpen(false);
    if (role) setNotice(`Your role changed to ${role === 'channel' && viewer.channelName ? `Channel owner for ${viewer.channelName}` : roleLabel(role)}.`);
  }, [roleKey, Boolean(state.viewer)]);
  // A page this role no longer has (Settings after a preview starts, Analytics after a demotion) falls back to its home.
  useEffect(() => {
    if (mode === 'simple' && !simpleAllowed(simpleTab)) setSimpleTab(simpleTabs[0]?.id || 'home');
    if (mode === 'classic' && !pageAllowed(active)) setActive(api.contentCatalog ? 'content-studio' : 'dashboard');
    if (active === 'content-studio' && !studioAllowed(studioView)) setStudioView('overview');
  }, [roleKey, mode, adminPages.join('|'), settingsAllowed]);
  useEffect(() => { if (!narrow) setDrawerOpen(false); }, [narrow]);

  function choosePlaybook(id) {
    const template = MARKETING_TEMPLATES.find(item => item.id === id);
    if (!template) return;
    if (template.sourceMode === 'comparison') navigate('compare', { templateId: id, reportPresetId: id });
    else if (template.sourceMode === 'dataset') navigate(state.datasets.length ? 'reports' : 'imports', { templateId: id, reportPresetId: id });
    else navigate('marketing-template', { templateId: id });
  }

  async function runPaletteItem(item) {
    if (item.action === 'studio') { navigateStudio(item.args.view); return; }
    if (item.action === 'runMission' && item.args?.missionId) {
      if (!canRun('runMission')) { setNotice(PREVIEW_TITLE); return; }
      await runBackground(`mission:${item.args.missionId}`, 'Workflow run', () => api.runMission(item.args.missionId), 'Workflow run complete.');
      return;
    }
    if (item.action === 'navigate') {
      navigate(item.args?.view || 'dashboard', item.args || {});
    }
  }

  function renderSettings() {
    return <SettingsView
      state={state}
      busy={busy}
      meta={meta}
      role={viewer.role || 'admin'}
      setupApi={api}
      onOpenPrograms={() => navigateStudio('research')}
      onSaveKey={(keyName, value) => runAction(() => api.saveKey(keyName, value), 'Credential saved.', keyName === 'OPENAI_API_KEY')}
      onClearKey={(keyName) => { const [name, consequence] = KEY_CONSEQUENCE[keyName] || ['this credential', '']; return window.confirm(`Disconnect ${name}? ${consequence}`) ? runAction(() => api.clearKey(keyName), 'Credential disconnected.', keyName === 'OPENAI_API_KEY') : Promise.resolve(null); }}
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
      onSaveMondayBoard={api.saveMondayBoard ? (payload) => runAction(() => api.saveMondayBoard(payload), (result) => `Monday.com board connected: ${result.boardName}.`) : undefined}
      onClearMondayBoard={() => runAction(() => api.clearMondayBoard(), 'Monday.com board forgotten. Trends stay on your board here.')}
    />;
  }
  // Analytics and People & roles, in either layout.
  function renderAdminPage(id) {
    if (id === 'analytics') return <AnalyticsView api={api} viewer={viewer} web={web} />;
    if (id === 'people') return <PeopleView api={api} web={web} busy={busy} action={runAction} viewer={viewer} onPreview={(channelId) => viewAs(channelId ? { role: 'channel', channelId } : { role: 'editor' })} />;
    return null;
  }
  const renderSimplePage = (id) => (id === 'settings' ? renderSettings() : renderAdminPage(id));

  const content = useMemo(() => {
    const common = { state, busy };
    if (active === 'content-studio') return <ContentStudioView state={state} api={api} busy={busy} activeView={studioView} onViewChange={(view) => withViewTransition(() => setStudioView(view))} shellNavigation={semrushShell} workspaceControlsInShell={Boolean(contentWorkspace)} createWorkspaceKey={createWorkspaceKey} onWorkspaceCreationHandled={() => setCreateWorkspaceKey(0)} onNavigate={navigate} onNotice={(message) => setNotice(message)} knowledgeTab={knowledgeTab} onKnowledgeTabChange={setKnowledgeTab} renderResearchProfiles={() => <BrandContextView {...common} onSaveProfile={(profile) => runAction(() => api.saveBrandProfile(profile), '', true)} onDeleteProfile={can('deleteBrandProfile') ? (id) => runAction(() => api.deleteBrandProfile(id), '', true) : undefined} onSelectProfile={(id) => runAction(() => api.selectBrandProfile(id), '', true)} />} renderLegacyLibrary={() => <LegacyLibrary state={state} busy={busy} onOpenAsset={(assetId) => runAction(() => api.openAsset(assetId), fileNotice('Asset opened.'))} onRevealAsset={(assetId) => runAction(() => api.revealAsset(assetId), fileNotice('Asset revealed in Finder.'))} />} />;
    if (active === 'sheets') return <SheetsView api={api} state={state} initialWorkbookId={sheetRequest.id} workbookRequestKey={sheetRequest.key} onNavigate={(target) => (target === 'research-programs' ? navigateStudio('research') : target === 'trend-board' ? navigateStudio('board') : navigate(target))} />;
    if (active === 'templates') return <TemplateLibraryView {...common} onChooseTemplate={choosePlaybook} onNavigate={navigate} />;
    if (active === 'imports') return <ImportDataView key={creation.key || 'import'} {...common} templateId={creation.templateId} reportPresetId={creation.reportPresetId} onPickFile={() => api.pickImportFile()} onPreview={(request) => api.previewImportDataset(request)} onImport={(request) => runAction(() => api.importDataset(request), '', true)} onNavigate={navigate} />;
    if (active === 'compare') return <CompareView {...common} onCompare={(request) => runAction(() => api.compareDatasets(request), '', true)} onSaveMonitor={(request) => runAction(() => api.saveMonitor(request), '', true)} onNavigate={navigate} />;
    if (active === 'search') return <SearchView {...common} onPreviewSearch={(request) => api.previewSearchSources(request)} onSearch={(request) => runBackground('search', 'Platform search', () => api.searchSources(request), '', true)} onRefreshActors={() => runAction(() => api.refreshApifyActors(), 'Apify Actors synced.', true)} onNavigate={navigate} />;
    if (active === 'chat') return <FindingsChatView {...common} selectedDatasetId={selectedDatasetId} onDatasetSelect={setSelectedDatasetId} onAskQuestion={(request) => runBackground('ask', 'Answering your question', () => api.askFindings(request), '', true)} onOpenSourceUrl={(url) => api.openSourceUrl(url)} onNavigate={navigate} />;
    if (active === 'marketing-template') return <MarketingTemplateView key={creation.key} templateId={creation.templateId} busy={busy} brandProfiles={state.brandProfiles} selectedBrandProfileId={state.settings.selectedBrandProfileId} onSelectBrandProfile={(id) => api.selectBrandProfile(id)} onManageProfiles={() => navigate('brands')} onOpenScrapers={() => navigate('automation')} onCancel={() => navigate('templates')} onSave={(recipe) => runAction(() => api.saveRecipe(recipe), 'Collection saved. Open Scrapers to collect pages, then AI reports to create the brief.', true)} />;
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
    if (active === 'runs') return <ActivityView {...common} onRunRecipe={(recipeId) => runBackground(`recipe:${recipeId}`, 'Scraper run', () => api.runRecipe(recipeId), 'Scraper run complete. New rows are in Datasets.')} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} onOpenStudio={navigateStudio} onCancelJob={(jobId) => confirmCancel() && runAction(() => api.cancelJob(jobId), 'Job cancelled.')} />;
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
        renderConversations={() => <ThreadsView {...common} payload={datasetPayload} selectedDataset={selectedDataset} onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)} onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), fileNotice('Analysis output opened.'))} onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), fileNotice('Analysis output revealed in Finder.'))} onAnalyze={(datasetId, kind) => runBackground(`analyze:${datasetId}:${kind}`, 'Conversation summary', () => api.analyzeDataset({ datasetId, kind }), 'Conversation summary complete.')} />} />;
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
          onAnalyze={(datasetId, kind, options = {}) => runBackground(`analyze:${datasetId}:${kind}`, 'AI report', () => api.analyzeDataset({ datasetId, kind, ...options }), 'AI report ready.')}
          onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), fileNotice('Analysis output opened.'))}
          onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), fileNotice('Analysis output revealed in Finder.'))}
        />
      );
    }
    if (active === 'settings') return renderSettings();
    if (ADMIN_PAGES[active]) return renderAdminPage(active);
    if (active === 'dashboard') return <HomeView state={state} busy={busy} onNavigate={navigate} />;
    return (
      <AdvancedView
        state={state}
        meta={meta}
        payload={payloadDatasetId === selectedDataset?.id ? payload : null}
        selectedDataset={selectedDataset}
        busy={busy}
        onPlanIntent={(command) => runAction(() => api.planIntent({ command, datasetId: selectedDataset?.id || '' }))}
        onRunIntent={(command) => runBackground('intent', 'Workflow run', () => api.runIntent({ command, datasetId: selectedDataset?.id || '' }), (result) => `Workflow complete: ${result.completedSteps} step${result.completedSteps === 1 ? '' : 's'}.`)}
        onRunAction={(action) => runBackground(`intent-action:${action.id || action.label || 'step'}`, 'Workflow step', () => api.runIntentAction(action), (result) => `Workflow step complete: ${result.completedSteps} step${result.completedSteps === 1 ? '' : 's'}.`)}
        onRunMission={(missionId) => runBackground(`mission:${missionId}`, 'Workflow run', () => api.runMission(missionId), 'Workflow run complete.')}
        onRunActionGraph={(graph) => runBackground('graph', 'Workflow run', () => api.runActionGraph({ graph }), 'Workflow run complete.')}
        onPauseMission={(missionId) => runAction(() => api.pauseMission(missionId), 'Mission paused.')}
        onScheduleMission={can('scheduleMission') ? (schedule) => runAction(() => api.scheduleMission(schedule), 'Mission watch loop saved.') : undefined}
        onExportMissionBundle={(missionId) => runAction(() => api.exportMissionBundle(missionId), 'Mission bundle exported.')}
        onSearchEvidence={(query) => api.searchEvidence(query)}
        onRetryJob={(jobId) => runBackground(`retry:${jobId}`, 'Retrying a job', () => api.retryJob(jobId), 'Retry finished.')}
        onReadJobLog={(jobId) => api.readJobLog(jobId)}
        onNavigate={navigate}
      />
    );
  }, [active, state, meta, busy, web, selectedDatasetId, payload, payloadError, selectedDataset, payloadDatasetId, creation, studioView, createWorkspaceKey, semrushShell, contentWorkspace, datasetTab, knowledgeTab, sheetRequest, viewer]);

  // One real pill slides under the active item (a snapshot would cover its label mid-transition).
  const primaryNavRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState(null);
  useLayoutEffect(() => {
    const nav = primaryNavRef.current;
    if (!nav) { setNavIndicator(null); return undefined; }
    const measure = () => {
      const button = nav.querySelector('button[aria-current="page"]');
      setNavIndicator((current) => button ? { left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight, settled: Boolean(current) } : null);
    };
    measure();
    // Keep the active item clear of the sidebar's edge fade.
    const scroller = nav.closest('.sidebar-body');
    const current = nav.querySelector('button[aria-current="page"]');
    if (scroller && current) {
      const item = current.getBoundingClientRect(); const view = scroller.getBoundingClientRect();
      if (item.bottom > view.bottom - 36) scroller.scrollBy?.({ top: item.bottom - view.bottom + 48, behavior: 'smooth' });
      else if (item.top < view.top + 24) scroller.scrollBy?.({ top: item.top - view.top - 36, behavior: 'smooth' });
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [active, studioView, moreOpen, semrushShell, mode, roleKey]);
  const navShown = (item) => item.id !== 'settings' && pageAllowed(item.id);
  const studioShown = (item) => (item.appView ? pageAllowed(item.appView) : studioAllowed(item.id));
  const renderNavItem = (item, index = 0) => {
    const Icon = item.icon;
    const count = item.id === 'automation' ? state.recipes.length : item.id === 'datasets' ? state.datasets.length : item.id === 'runs' ? state.jobs.length : 0;
    return <Button key={item.id} aria-label={item.label} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} style={{ '--i': index }} onClick={() => navigate(item.id)}><Icon size={18} aria-hidden="true" /><span>{item.label}</span>{count > 0 && <span className="nav-count">{count}</span>}</Button>;
  };
  const paletteItems = [
    ...(can('saveRecipe') ? [{ id: 'create-scraper', label: 'Create a new scraper', icon: Globe2, action: 'navigate', args: { view: 'automation', create: true } }] : []),
    ...(api.contentCatalog ? STUDIO_NAV.filter((item) => !item.appView && studioShown(item)).map((item) => ({ id: `studio-${item.id}`, label: `Open ${item.label}`, icon: item.icon, action: 'studio', args: { view: item.id } })) : []),
    ...NAV.filter((item) => !(semrushShell && item.id === 'dashboard') && (item.id === 'settings' ? settingsAllowed : navShown(item))).map((item) => ({ id: `go-${item.id}`, label: `Open ${item.id === 'dashboard' && api.contentCatalog ? 'Collection overview' : item.label}`, icon: item.icon, action: 'navigate', args: { view: item.id } })),
    ...adminPages.map((id) => ({ id: `go-${id}`, label: `Open ${ADMIN_PAGES[id].label}`, icon: ADMIN_PAGES[id].icon, action: 'navigate', args: { view: id } })),
    ...(can('runMission') ? (state.v5?.commandPalette || []).filter((item) => item.action === 'runMission' && item.args?.missionId) : []),
  ];
  const studioState = state.contentStudio || {};
  const channelView = studioState.channelView;
  const dismiss = () => { setError(''); setNotice(''); };

  // First load: nothing to show yet, and on the web this person's role isn't known, so no frame until it is.
  if (loading && !state.viewer) return <div className="studio-boot" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><p>Opening your studio…</p></div>;
  // Signed in, but not a member (or paused): no sidebar, just who to ask.
  if (state.viewer && !state.viewer.role) {
    return <ViewerContext.Provider value={viewer}><NoAccess viewer={viewer} admins={list(state.team?.admins)} canSignOut={Boolean(api.signOut)} onRetry={refresh} onSignOut={() => api.signOut?.()} /></ViewerContext.Provider>;
  }

  const inWorkspace = (run) => !studioState.activeWorkspaceId || !run.workspaceId || run.workspaceId === studioState.activeWorkspaceId;
  const liveRuns = mode === 'channel' ? list(channelView?.runs).filter((run) => ACTIVE_RUN.has(run.status)).length
    : [...list(state.jobs), ...list(studioState.researchRuns).filter(inWorkspace), ...list(studioState.contentRuns).filter(inWorkspace)].filter((run) => ACTIVE_RUN.has(run.status)).length;
  const backgroundLabels = Object.values(background);
  // The Advanced top bar already says "Working" for quick actions, so the sidebar only counts real jobs there.
  const working = liveRuns || (backgroundLabels.length === 1 ? `${backgroundLabels[0]}…` : backgroundLabels.length > 1 ? `${backgroundLabels.length} tasks running` : mode !== 'classic' && busy ? true : 0);
  const classicTitle = ADMIN_PAGES[active]?.label || (semrushShell && active === 'content-studio' ? STUDIO_NAV.find(item => item.id === studioView)?.label : semrushShell && active === 'dashboard' ? 'Collection overview' : undefined);
  const simpleItems = simpleTabs.map((tab, index) => ({ id: tab.id, label: tab.label, icon: tab.icon, shortcut: index < 9 ? `⌘${index + 1}` : undefined, count: simpleCounts[tab.id] || 0 }));
  const newTrends = Number(channelView?.counts?.newTrends) || 0;
  const channelItems = CHANNEL_TABS.filter((tab) => !navMain || navMain.includes(tab.id)).map((tab) => ({ ...tab, count: tab.id === 'trends' ? newTrends : 0, countLabel: tab.id === 'trends' ? `${newTrends} new` : undefined }));
  const pageTitle = mode === 'channel' ? viewer.channelName || 'Your channel'
    : mode === 'simple' ? (SIMPLE_TABS.find((tab) => tab.id === simpleTab)?.label || ADMIN_PAGES[simpleTab]?.label || (simpleTab === 'settings' ? 'Settings' : ''))
    : classicTitle || NAV.find((item) => item.id === active)?.label || 'Overview';
  const adminItems = adminPages.map((id) => ({ id, label: ADMIN_PAGES[id].label, icon: ADMIN_PAGES[id].icon, spot: `nav.${id}` }));
  const activeAdmin = mode === 'simple' ? simpleTab : mode === 'classic' ? active : '';
  const settingsActive = (mode === 'simple' && simpleTab === 'settings') || (mode === 'classic' && active === 'settings');
  const signOut = web && api.signOut ? () => api.signOut() : undefined;
  // From a Simple "Show me" step: below 860px the sidebar is a drawer, so open it for nav.* spots and close it after.
  const revealNav = (open) => { if (narrow && mode !== 'channel') setDrawerOpen(Boolean(open)); };

  const classicNav = <>
    <nav aria-label="Primary" ref={primaryNavRef}>{navIndicator && <span className={`nav-indicator ${navIndicator.settled ? 'settled' : ''}`} aria-hidden="true" style={{ transform: `translate(${navIndicator.left}px, ${navIndicator.top}px)`, width: navIndicator.width, height: navIndicator.height }} />}<div className="nav-group">{semrushShell ? STUDIO_NAV.filter(studioShown).map(item => { const Icon = item.icon; const selected = item.appView ? active === item.appView : active === 'content-studio' && studioView === item.id; return <Button key={item.id} aria-label={item.label} className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined} onClick={() => (item.appView ? navigate(item.appView) : navigateStudio(item.id))}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></Button>; }) : <><small>WORKSPACE</small>{NAV.filter((item) => item.group === 'Workspace' && navShown(item)).map((item) => renderNavItem(item))}</>}</div>
      <div className="nav-group more-nav"><Button className="more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><SlidersHorizontal size={18} /><span>More tools</span><ChevronDown className={moreOpen ? 'rotated' : ''} size={14} /></Button>{moreOpen && NAV.filter((item) => (semrushShell ? !['content-studio', 'settings', 'sheets'].includes(item.id) : item.group === 'More tools') && navShown(item)).map((item, index) => renderNavItem(semrushShell && item.id === 'dashboard' ? { ...item, label: 'Collection overview' } : item, index))}</div>
    </nav>
    {!semrushShell && !state.keys.APIFY_API_TOKEN && settingsAllowed && <div className="sidebar-setup"><span className="small-icon"><PlugZap size={17} /></span><strong>A little setup.<br />A lot to discover.</strong><p>Connect Apify to start collecting from the web.</p><Button className="ghost" onClick={() => navigate('settings')}>Connect Apify <ArrowUpRight size={14} /></Button></div>}
  </>;

  const main = mode === 'channel'
    ? <main className="channel-main" key={`channel-${roleEpoch}`}>
      {channelTab === 'assets'
        ? <ChannelAssets api={api} web={web} view={channelView} viewer={viewer} busy={busy} action={runAction} cache={channelCache} onCache={(key, url) => setChannelCache((current) => ({ ...current, [key]: url }))} focusThemeId={channelFocus} />
        : <ChannelTrends api={api} view={channelView} viewer={viewer} busy={busy} action={runAction} imagesReady={studioState.capabilities?.imagesConfigured ?? true} onOpenAssets={(themeId) => goChannel('assets', themeId || '')} onPrefs={(patch) => Promise.resolve(api.setViewPrefs?.(patch)).catch(() => null)} onToast={setNotice} />}
    </main>
    : mode === 'simple'
      ? <SimpleMode key={`simple-${roleEpoch}`} api={api} state={state} meta={meta} busy={busy} loading={loading} notice={notice} error={error} onDismiss={dismiss} action={runAction} background={backgroundLabels} renderPage={renderSimplePage} tab={simpleTab} onTab={goSimple} tabs={simpleTabs.map((tab) => tab.id)} settingsAllowed={settingsAllowed} onOpenClassic={openClassicPage} onNotice={setNotice} onCounts={setSimpleCounts} onNavSpot={revealNav} spotRoot={() => frameRef.current} />
      : <main className="workspace" key={`classic-${roleEpoch}`}>
        <Header active={active === 'marketing-template' ? 'dashboard' : active} title={classicTitle} busy={busy} background={backgroundLabels} state={state} onAskAi={askAllowed ? () => setHelpOpen((open) => !open) : undefined} askAiOpen={helpOpen} onRefresh={() => runAction(refresh)} onOpenPalette={() => setPaletteOpen(true)} />
        <div className={`content${active === 'sheets' ? ' content-fill' : active === 'chat' ? ' content-fit' : ''}`} ref={contentRef}>
          {(error || notice) && <div className="feedback" onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}><StatusBanner error={error} notice={notice} /><Button className="ghost icon-button" aria-label="Dismiss notification" onClick={dismiss}><X size={16} /></Button></div>}
          <JobTray jobs={state.jobs || []} busy={false} onCancelJob={(jobId) => confirmCancel() && runAction(() => api.cancelJob(jobId), 'Job cancelled.')} />
          {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={26} aria-hidden="true" /><h2>Opening your workspace</h2><p>Loading your research, sheets and reports.</p></div> : <ErrorBoundary page key={`${active}:${studioView}`}>{content}</ErrorBoundary>}
        </div>
        {askAllowed && <HelpAssistant api={api} open={helpOpen} imagesReady={Boolean(state.keys?.OPENAI_API_KEY)} copy={settingsAllowed ? {} : { noPictures: `Pictures are off for your team. ${askAdmin} can turn them on.` }} onClose={() => setHelpOpen(false)} page={{ id: active === 'content-studio' ? studioView : active, label: (classicTitle || NAV.find((item) => item.id === active)?.label) || '', layout: 'classic' }} onOpenPage={openHelpPage} onOpenSettings={settingsAllowed ? () => navigate('settings') : undefined} />}
        <CommandPalette open={paletteOpen} items={paletteItems} onClose={() => setPaletteOpen(false)} onRun={runPaletteItem} />
      </main>;

  // One frame for every layout and role: the sidebar is never remounted, only the main column changes, so focus stays
  // on the control just pressed (the layout switch, View as) while the page beside it changes.
  return <ViewerContext.Provider value={viewer}><UnsavedContext.Provider value={guard}>
    <div ref={frameRef} className={`app-shell studio-frame${web ? '' : ' is-desktop'}`} data-edition={semrushShell ? 'semrush' : 'general'} data-mode={mode}>
      <StudioSidebar edition={semrushShell ? 'semrush' : 'general'} meta={meta} web={web} viewer={viewer} workspaces={contentWorkspaces} activeWorkspaceId={contentWorkspace?.id || ''} mode={mode} busy={busy} working={working}
        onSelectWorkspace={switchWorkspace}
        onNewWorkspace={switchWorkspace && can('saveContentWorkspace') ? () => { setCreateWorkspaceKey((value) => value + 1); if (mode === 'simple') openClassicPage('knowledge'); else navigateStudio('knowledge'); } : undefined}
        onViewAs={api.setViewAs && realAdmin ? viewAs : undefined} onMode={chooseMode} onSignOut={signOut} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)}
        adminItems={mode === 'channel' ? [] : adminItems} activeAdmin={activeAdmin} onAdminNavigate={openAdminPage} showSettings={settingsAllowed && mode !== 'channel'} settingsActive={settingsActive} onSettings={openSettings}>
        {mode === 'channel' ? <SidebarNav ariaLabel="Main" items={channelItems} active={channelTab} onNavigate={goChannel} />
          : mode === 'simple' ? <SidebarNav ariaLabel="Main" items={simpleItems} active={simpleTab} onNavigate={goSimple} />
          : classicNav}
      </StudioSidebar>
      <div className="studio-main">
        <StudioTopBar title={pageTitle} working={working} mode={mode} drawerOpen={drawerOpen} onMenu={() => setDrawerOpen((open) => !open)} channelName={viewer.channelName || ''} web={web} onSignOut={signOut} />
        <PreviewBanner viewer={viewer} busy={busy} onBack={api.setViewAs ? () => viewAs({ role: 'admin' }) : undefined} />
        {main}
        {mode === 'channel' && (error || notice) && <div className={`studio-toast${error ? ' error' : ''}`} role={error ? 'alert' : 'status'} onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}><span>{error || notice}</span><button type="button" className="studio-toast-close" aria-label="Dismiss" onClick={dismiss}><X size={15} aria-hidden="true" /></button></div>}
        {mode === 'channel' && <ChannelBottomNav items={channelItems} active={channelTab} onNavigate={goChannel} />}
      </div>
    </div>
  </UnsavedContext.Provider></ViewerContext.Provider>;
}
