import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, Boxes, ChevronDown, ChevronRight, Database, FileText, FolderOpen, Globe2, Home, Layers3, LayoutGrid, LoaderCircle, MessageSquare, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, SquareKanban, PlugZap, X } from 'lucide-react';
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
import semrushWordmark from './assets/semrush-2026-logo.svg';
import { HomeView } from './home-view.jsx';
import { SettingsView } from './settings-view.jsx';
import { Badge, Button, Empty, StatusBanner, label, number, short, statusTone, withViewTransition } from './ui.jsx';

const NAV = [
  { id: 'content-studio', label: 'Content studio', icon: Sparkles, group: 'Workspace' },
  { id: 'dashboard', label: 'Overview', icon: Home, group: 'Workspace' },
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
  { id: 'board', label: 'Trend board', icon: SquareKanban },
  { id: 'create', label: 'Create content', icon: FileText },
  { id: 'library', label: 'Library', icon: FolderOpen },
  { id: 'knowledge', label: 'Brand knowledge', icon: BookOpen },
];
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
      return (
        <div className="app-fallback" role="alert">
          <strong>This screen stopped working.</strong>
          <span>Your saved work is safe. Try again, or switch views from the sidebar. Details: {this.state.error.message || String(this.state.error)}</span>
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
        <form onSubmit={previewPlan} className="ws-stack"><label htmlFor="workflow-dataset" className="ws-field">Use dataset<select id="workflow-dataset" value={datasetId} onChange={(event) => props.onNavigate('missions', { datasetId: event.target.value })}>{!datasetId && <option value="">No dataset collected yet</option>}{props.state.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
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

function Header({ active, title, busy, state, onRefresh, onOpenPalette }) {
  const item = NAV.find((nav) => nav.id === active);
  return <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} aria-hidden="true" /><h1>{title || item?.label || 'Overview'}</h1></div><div className="topbar-right"><Button className="search-command ghost" onClick={onOpenPalette}><Search size={16} /><span>Search or jump to…</span><kbd>⌘ K</kbd></Button>{busy && <span className="working-status" role="status"><LoaderCircle className="spin" size={14} />Working</span>}<Button className={`ghost icon-button ${busy ? 'is-working' : ''}`} aria-label="Refresh workspace" title="Refresh workspace" disabled={busy} onClick={onRefresh}><RefreshCw size={16} /></Button></div></header>;
}
function MobileNav({ active, onNavigate, items = NAV, workspaces = [], workspaceId, busy, onWorkspaceChange }) {
  return <div className="mobile-nav">{workspaces.length > 0 && <label className="mobile-workspace-picker"><span>Workspace</span><select aria-label="Switch workspace" value={workspaceId} disabled={busy} onChange={(event) => onWorkspaceChange(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}<label htmlFor="mobile-view">Navigate</label><select id="mobile-view" value={active} onChange={(event) => onNavigate(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>;
}
export default function App() {
  return <ErrorBoundary>{window.apifyStudio ? <StudioApp api={window.apifyStudio} /> : <ApiUnavailable />}</ErrorBoundary>;
}

function StudioApp({ api }) {

  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(EMPTY_STATE);
  const [active, setActive] = useState(api.contentCatalog ? 'content-studio' : 'dashboard');
  const [studioView, setStudioView] = useState('overview');
  const [createWorkspaceKey, setCreateWorkspaceKey] = useState(0);
  const contentWorkspaces = state.contentStudio?.workspaces || [];
  const contentWorkspace = contentWorkspaces.find(item => item.id === state.contentStudio?.activeWorkspaceId);
  const semrushShell = contentWorkspace?.editionId === 'semrush';
  const hasWorkspaceSwitcher = Boolean(contentWorkspace && api.selectContentWorkspace);
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
  const [payloadDatasetId, setPayloadDatasetId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [payload, setPayload] = useState(null);
  const datasetKey = state.datasets.map((dataset) => `${dataset.id}:${dataset.itemCount}:${dataset.createdAt}`).join('|');

  async function refresh() {
    const [nextMeta, nextState] = await Promise.all([api.appMeta(), api.state()]);
    setMeta(nextMeta);
    setState({ ...EMPTY_STATE, ...nextState });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message || String(err))).finally(() => setLoading(false));
    return api.onStateChanged((next) => setState({ ...EMPTY_STATE, ...next }));
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setPaletteOpen(false);
        navigateRef.current('settings');
      }
      if (event.key === 'Escape') setPaletteOpen(false);
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
    if (!datasetId) {
      setPayload(null);
      return;
    }
    if (datasetId !== selectedDatasetId) setSelectedDatasetId(datasetId);
    api.readDataset(datasetId).then((nextPayload) => {
      if (!cancelled) { setPayload(nextPayload); setPayloadDatasetId(datasetId); }
    }).catch((err) => {
      if (cancelled) return;
      setNotice('');
      setError(err.message || String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDatasetId, datasetKey]);

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
      setError(err.message || String(err));
      if (throwOnError) throw err;
      return null;
    } finally {
      setPendingActions((count) => Math.max(0, count - 1));
    }
  }

  const selectedDataset = useMemo(
    () => state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0] || null,
    [state.datasets, selectedDatasetId],
  );

  function navigate(view, args = {}) {
    withViewTransition(() => applyNavigation(view, args));
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  function applyNavigation(view, args = {}) {
    setNotice('');
    setError('');
    if (args.datasetId) setSelectedDatasetId(args.datasetId);
    if (STUDIO_HOME_FOR[view]) {
      if (view === 'brands') setKnowledgeTab('profiles');
      setStudioView(STUDIO_HOME_FOR[view]);
      setActive('content-studio');
      return;
    }
    if (DATASET_TAB_FOR[view]) { setDatasetTab(DATASET_TAB_FOR[view]); view = 'datasets'; }
    else if (view === 'datasets' && args.tab) setDatasetTab(args.tab);
    const nextView = (view === 'marketing-template' || NAV.some((item) => item.id === view)) ? view : 'dashboard';
    if (args.create || args.templateId || args.reportPresetId || args.analysisId) setCreation((current) => ({ key: (current.key || 0) + 1, templateId: args.templateId || '', reportPresetId: args.reportPresetId || '', analysisId: args.analysisId || '' }));
    else if (['reports', 'imports'].includes(nextView)) setCreation({ key: null, templateId: '', reportPresetId: '', analysisId: '' });
    else if (nextView === 'automation') setCreation({ key: null, templateId: '' });
    if (NAV.find((item) => item.id === nextView)?.group === 'More tools' || (semrushShell && nextView !== 'content-studio' && nextView !== 'settings')) setMoreOpen(true);
    setActive(nextView);
  }

  function navigateStudio(view) {
    withViewTransition(() => {
      setStudioView(view);
      applyNavigation('content-studio');
    });
  }

  function choosePlaybook(id) {
    const template = MARKETING_TEMPLATES.find(item => item.id === id);
    if (!template) return;
    if (template.sourceMode === 'comparison') navigate('compare', { templateId: id, reportPresetId: id });
    else if (template.sourceMode === 'dataset') navigate(state.datasets.length ? 'reports' : 'imports', { templateId: id, reportPresetId: id });
    else navigate('marketing-template', { templateId: id });
  }

  async function runPaletteItem(item) {
    if (item.action === 'runMission' && item.args?.missionId) {
      await runAction(() => api.runMission(item.args.missionId), 'Mission run complete.');
      return;
    }
    if (item.action === 'navigate') {
      navigate(item.args?.view || 'dashboard', item.args || {});
    }
  }

  const content = useMemo(() => {
    const common = { state, busy };
    if (active === 'content-studio') return <ContentStudioView state={state} api={api} busy={busy} activeView={studioView} onViewChange={(view) => withViewTransition(() => setStudioView(view))} shellNavigation={semrushShell} workspaceControlsInShell={hasWorkspaceSwitcher} createWorkspaceKey={createWorkspaceKey} onWorkspaceCreationHandled={() => setCreateWorkspaceKey(0)} onNavigate={navigate} onNotice={(message) => setNotice(message)} knowledgeTab={knowledgeTab} onKnowledgeTabChange={setKnowledgeTab} renderResearchProfiles={() => <BrandContextView {...common} onSaveProfile={(profile) => runAction(() => api.saveBrandProfile(profile), 'Brand context saved.', true)} onDeleteProfile={(id) => runAction(() => api.deleteBrandProfile(id), 'Profile removed. Existing research keeps its saved context.', true)} onSelectProfile={(id) => runAction(() => api.selectBrandProfile(id), 'Workspace brand selected.', true)} />} renderLegacyLibrary={() => <LegacyLibrary state={state} busy={busy} onOpenAsset={(assetId) => runAction(() => api.openAsset(assetId), 'Asset opened.')} onRevealAsset={(assetId) => runAction(() => api.revealAsset(assetId), 'Asset revealed in Finder.')} />} />;
    if (active === 'templates') return <TemplateLibraryView {...common} onChooseTemplate={choosePlaybook} onNavigate={navigate} />;
    if (active === 'imports') return <ImportDataView key={creation.key || 'import'} {...common} templateId={creation.templateId} reportPresetId={creation.reportPresetId} onPickFile={() => api.pickImportFile()} onPreview={(request) => api.previewImportDataset(request)} onImport={(request) => runAction(() => api.importDataset(request), 'Research imported with source provenance.', true)} onNavigate={navigate} />;
    if (active === 'compare') return <CompareView {...common} onCompare={(request) => runAction(() => api.compareDatasets(request), 'Snapshots compared.', true)} onSaveMonitor={(request) => runAction(() => api.saveMonitor(request), 'Manual source check saved.', true)} onNavigate={navigate} />;
    if (active === 'search') return <SearchView {...common} onPreviewSearch={(request) => api.previewSearchSources(request)} onSearch={(request) => runAction(() => api.searchSources(request), '', true)} onRefreshActors={() => runAction(() => api.refreshApifyActors(), 'Apify Actors synced.', true)} onNavigate={navigate} />;
    if (active === 'chat') return <FindingsChatView {...common} selectedDatasetId={selectedDatasetId} onDatasetSelect={setSelectedDatasetId} onAskQuestion={(request) => runAction(() => api.askFindings(request), '', true)} onOpenSourceUrl={(url) => api.openSourceUrl(url)} onNavigate={navigate} />;
    if (active === 'marketing-template') return <MarketingTemplateView key={creation.key} templateId={creation.templateId} busy={busy} brandProfiles={state.brandProfiles} selectedBrandProfileId={state.settings.selectedBrandProfileId} onSelectBrandProfile={(id) => api.selectBrandProfile(id)} onManageProfiles={() => navigate('brands')} onOpenScrapers={() => navigate('automation')} onCancel={() => navigate('templates')} onSave={(recipe) => runAction(() => api.saveRecipe(recipe), 'Collection saved. Open Scrapers to collect pages, then AI reports to create the brief.', true)} />;
    if (active === 'automation') {
      return (
        <AutomationView
          {...common}
          initialTemplateId={creation.templateId}
          creationKey={creation.key}
          onSaveRecipe={(recipe) => runAction(() => api.saveRecipe(recipe), 'Recipe saved.')}
          onRunRecipe={(recipeId) => runAction(() => api.runRecipe(recipeId), 'Apify run complete.')}
          onDeleteRecipe={(recipeId) => runAction(() => api.deleteRecipe(recipeId), 'Recipe deleted.')}
          onDiscoverApifyResource={(payload) => api.discoverApifyResource(payload)}
          onTestRecipe={(recipe) => api.testRecipe(recipe)}
          onSaveRecipeVersion={(payload) => runAction(() => api.saveRecipeVersion(payload), 'Recipe version saved.')}
          onOpenDataset={(datasetId) => navigate('datasets', { datasetId, tab: 'explorer' })}
        />
      );
    }
    if (active === 'runs') return <ActivityView {...common} onRunRecipe={(recipeId) => runAction(() => api.runRecipe(recipeId), 'Apify run complete.')} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} onOpenStudio={navigateStudio} onCancelJob={(jobId) => runAction(() => api.cancelJob(jobId), 'Job cancelled.')} />;
    if (active === 'datasets') {
      const datasetPayload = payloadDatasetId === selectedDataset?.id ? payload : null;
      return <DatasetHub state={state} tab={datasetTab} onTabChange={setDatasetTab} selectedDataset={selectedDataset} payload={datasetPayload} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} onOpenSourceUrl={(url) => api.openSourceUrl(url)}
        renderExplorer={() => (
        <DatasetsView
          {...common}
          selectedDatasetId={selectedDatasetId}
          onDatasetSelect={setSelectedDatasetId}
          payload={payloadDatasetId === selectedDataset?.id ? payload : null}
          onNavigate={navigate}
          onSearchEvidence={(query) => api.searchEvidence(query)}
          onAnalyze={(datasetId, kind, options = {}) => runAction(() => api.analyzeDataset({ datasetId, kind, ...options }), 'AI analysis complete.')}
          onExportDataset={(datasetId, format) => runAction(() => api.exportDataset({ datasetId, format }), (result) => `Exported ${result.itemCount} rows to ${result.format.toUpperCase()}.`)}
          onExportDatasetToSheets={(datasetId) => runAction(() => api.exportDatasetToSheets({ datasetId }), (result) => `Wrote ${number(result.rowCount || 0)} rows to ${result.tabName || 'Sheets'}.`)}
        />)}
        renderConversations={() => <ThreadsView {...common} payload={datasetPayload} selectedDataset={selectedDataset} onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)} onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), 'Analysis output opened.')} onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), 'Analysis output revealed in Finder.')} onAnalyze={(datasetId, kind) => runAction(() => api.analyzeDataset({ datasetId, kind }), 'Conversation summary complete.')} />} />;
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
          onAnalyze={(datasetId, kind, options = {}) => runAction(() => api.analyzeDataset({ datasetId, kind, ...options }), 'AI analysis complete.')}
          onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), 'Analysis output opened.')}
          onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), 'Analysis output revealed in Finder.')}
        />
      );
    }
    if (active === 'settings') {
      return (
        <SettingsView
          {...common}
          meta={meta}
          onSaveKey={(keyName, value) => runAction(() => api.saveKey(keyName, value), 'Credential saved.', keyName === 'OPENAI_API_KEY')}
          onClearKey={(keyName) => runAction(() => api.clearKey(keyName), 'Credential disconnected.', keyName === 'OPENAI_API_KEY')}
          onSaveSettings={(settings) => runAction(() => api.saveSettings(settings), 'Settings saved.')}
          onTestSheetsBridge={() => runAction(() => api.testSheetsBridge(), 'Sheets bridge reachable.')}
          onArchiveAndClearSheets={(payload) => runAction(() => api.archiveAndClearSheets(payload), 'Working sheet archived and cleared.')}
          onImportWorkingSheets={() => runAction(() => api.importWorkingSheets(), 'Working sheet imported.')}
          onReplaySheetRun={(sheetRunId) => runAction(() => api.replaySheetRun(sheetRunId), 'Sheet run replayed.')}
          onTestImages={() => api.testImageProvider()}
          onCheckAi={(request) => api.checkAi(request)}
          onCheckCodex={() => api.checkCodex()}
          onOpenDataFolder={() => runAction(() => api.openDataFolder(), 'Data folder opened.')}
          onOpenWorkspace={() => runAction(() => api.openWorkspace('default'), 'Workspace opened.')}
          onSaveMondayBoard={api.saveMondayBoard ? (payload) => runAction(() => api.saveMondayBoard(payload), (result) => `Monday.com board connected: ${result.boardName}.`) : undefined}
          onClearMondayBoard={() => runAction(() => api.clearMondayBoard(), 'Monday.com board forgotten. Trends stay on your board here.')}
        />
      );
    }
    if (active === 'dashboard') return <HomeView state={state} busy={busy} onNavigate={navigate} />;
    return (
      <AdvancedView
        state={state}
        meta={meta}
        payload={payloadDatasetId === selectedDataset?.id ? payload : null}
        selectedDataset={selectedDataset}
        busy={busy}
        onPlanIntent={(command) => runAction(() => api.planIntent({ command, datasetId: selectedDataset?.id || '' }))}
        onRunIntent={(command) => runAction(() => api.runIntent({ command, datasetId: selectedDataset?.id || '' }), (result) => `Smart run complete: ${result.completedSteps} step${result.completedSteps === 1 ? '' : 's'}.`)}
        onRunAction={(action) => runAction(() => api.runIntentAction(action), (result) => `Smart action complete: ${result.completedSteps} step${result.completedSteps === 1 ? '' : 's'}.`)}
        onRunMission={(missionId) => runAction(() => api.runMission(missionId), 'Mission run complete.')}
        onRunActionGraph={(graph) => runAction(() => api.runActionGraph({ graph }), 'Edited graph complete.')}
        onPauseMission={(missionId) => runAction(() => api.pauseMission(missionId), 'Mission paused.')}
        onScheduleMission={(schedule) => runAction(() => api.scheduleMission(schedule), 'Mission watch loop saved.')}
        onExportMissionBundle={(missionId) => runAction(() => api.exportMissionBundle(missionId), 'Mission bundle exported.')}
        onSearchEvidence={(query) => api.searchEvidence(query)}
        onRetryJob={(jobId) => runAction(() => api.retryJob(jobId), 'Retry started.')}
        onReadJobLog={(jobId) => api.readJobLog(jobId)}
        onNavigate={navigate}
      />
    );
  }, [active, state, meta, busy, selectedDatasetId, payload, selectedDataset, payloadDatasetId, creation, studioView, createWorkspaceKey, semrushShell, hasWorkspaceSwitcher, datasetTab, knowledgeTab]);

  // One real pill slides under the active item (a snapshot would cover its label mid-transition).
  const primaryNavRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState(null);
  useLayoutEffect(() => {
    const nav = primaryNavRef.current;
    if (!nav) return undefined;
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
  }, [active, studioView, moreOpen, semrushShell]);
  const renderNavItem = (item, index = 0) => {
    const Icon = item.icon;
    const count = item.id === 'automation' ? state.recipes.length : item.id === 'datasets' ? state.datasets.length : item.id === 'runs' ? state.jobs.length : 0;
    return <Button key={item.id} aria-label={item.label} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} style={{ '--i': index }} onClick={() => navigate(item.id)}><Icon size={18} aria-hidden="true" /><span>{item.label}</span>{count > 0 && <span className="nav-count">{count}</span>}</Button>;
  };
  const paletteItems = [
    { id: 'create-scraper', label: 'Create a new scraper', icon: Globe2, action: 'navigate', args: { view: 'automation', create: true } },
    ...NAV.map((item) => ({ id: `go-${item.id}`, label: `Open ${item.label}`, icon: item.icon, action: 'navigate', args: { view: item.id } })),
    ...(state.v5?.commandPalette || []).filter((item) => item.action === 'runMission' && item.args?.missionId),
  ];
  const studioState = state.contentStudio || {};
  const liveRuns = [...(state.jobs || []), ...(studioState.researchRuns || []), ...(studioState.contentRuns || [])].filter((run) => ['queued', 'running'].includes(run.status)).length;
  return (
    <div className="app-shell" data-edition={semrushShell ? 'semrush' : 'general'}>
      <aside className="sidebar">
        <div className="brand">{semrushShell ? <div className="semrush-brand"><img src={semrushWordmark} alt="Semrush" className="semrush-wordmark" /><span>Research & content studio</span></div> : <><span className="brand-mark"><Layers3 size={23} strokeWidth={1.8} /></span><div><strong>scraper<span>studio</span></strong><small>POWERED BY APIFY</small></div></>}</div>
        <div className="sidebar-body">
          {hasWorkspaceSwitcher ? <div className="shell-workspace-control"><label className="shell-workspace-picker"><span className="workspace-avatar"><Layers3 size={15} aria-hidden="true" /></span><select aria-label="Content workspace" value={contentWorkspace.id} disabled={busy} onChange={(event) => runAction(() => api.selectContentWorkspace(event.target.value))}>{contentWorkspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="shell-new-workspace" type="button" disabled={busy} onClick={() => { setCreateWorkspaceKey(value => value + 1); navigateStudio('knowledge'); }}>+ New workspace</button></div> : <div className="workspace-label"><span className="workspace-avatar">S</span><div><strong>My workspace</strong><small>Local to this Mac</small></div></div>}
          <nav aria-label="Primary" ref={primaryNavRef}>{navIndicator && <span className={`nav-indicator ${navIndicator.settled ? 'settled' : ''}`} aria-hidden="true" style={{ transform: `translate(${navIndicator.left}px, ${navIndicator.top}px)`, width: navIndicator.width, height: navIndicator.height }} />}<div className="nav-group">{semrushShell ? STUDIO_NAV.map(item => { const Icon = item.icon; const selected = active === 'content-studio' && studioView === item.id; return <Button key={item.id} aria-label={item.label} className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined} onClick={() => navigateStudio(item.id)}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></Button>; }) : <><small>WORKSPACE</small>{NAV.filter((item) => item.group === 'Workspace').map((item) => renderNavItem(item))}</>}</div>
            <div className="nav-group more-nav"><Button className="more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><SlidersHorizontal size={18} /><span>More tools</span><ChevronDown className={moreOpen ? 'rotated' : ''} size={14} /></Button>{moreOpen && NAV.filter((item) => semrushShell ? !['content-studio', 'settings'].includes(item.id) : item.group === 'More tools').map((item, index) => renderNavItem(semrushShell && item.id === 'dashboard' ? { ...item, label: 'Collection overview' } : item, index))}</div>
          </nav>
          {!semrushShell && !state.keys.APIFY_API_TOKEN && <div className="sidebar-setup"><span className="small-icon"><PlugZap size={17} /></span><strong>A little setup.<br />A lot to discover.</strong><p>Connect Apify to start collecting from the web.</p><Button className="ghost" onClick={() => navigate('settings')}>Connect Apify <ArrowUpRight size={14} /></Button></div>}
        </div>
        <div className="sidebar-bottom"><nav aria-label="Preferences">{renderNavItem(NAV.find((item) => item.id === 'settings'))}</nav><div className="sidebar-foot" role="status"><span className="local-dot" data-live={liveRuns ? '' : undefined} aria-hidden="true" /><span>{liveRuns ? `${number(liveRuns)} ${liveRuns === 1 ? 'run' : 'runs'} in progress` : 'Local workspace'}</span><span className="version">v{meta?.version || '0.1.0'}</span></div></div>
      </aside>
      <main className="workspace">
        <Header active={active === 'marketing-template' ? 'dashboard' : active} title={semrushShell && active === 'content-studio' ? STUDIO_NAV.find(item => item.id === studioView)?.label : undefined} busy={busy} state={state} onRefresh={() => runAction(refresh)} onOpenPalette={() => setPaletteOpen(true)} />
        <MobileNav workspaces={hasWorkspaceSwitcher ? contentWorkspaces : []} workspaceId={contentWorkspace?.id} busy={busy} onWorkspaceChange={id => runAction(() => api.selectContentWorkspace(id))} active={semrushShell && active === 'content-studio' ? `studio:${studioView}` : active === 'marketing-template' ? 'dashboard' : active} items={semrushShell ? [...STUDIO_NAV.map(item => ({ ...item, id: `studio:${item.id}` })), ...NAV.filter(item => item.id !== 'content-studio').map(item => item.id === 'dashboard' ? { ...item, label: 'Collection overview' } : item)] : NAV} onNavigate={value => value.startsWith('studio:') ? navigateStudio(value.slice(7)) : navigate(value)} />
        <div className="content" ref={contentRef}>
          {(error || notice) && <div className="feedback" onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}><StatusBanner error={error} notice={notice} /><Button className="ghost icon-button" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></Button></div>}
          <JobTray jobs={state.jobs || []} busy={false} onCancelJob={(jobId) => runAction(() => api.cancelJob(jobId), 'Job cancelled.')} />
          {loading ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={26} /><h2>Opening your workspace</h2><p>Loading your scrapers, datasets, and reports.</p></div> : content}
        </div>
        <CommandPalette open={paletteOpen} items={paletteItems} onClose={() => setPaletteOpen(false)} onRun={runPaletteItem} />
      </main>
    </div>
  );
}
