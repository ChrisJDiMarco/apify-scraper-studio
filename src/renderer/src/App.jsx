import React, { useEffect, useMemo, useState } from 'react';
import { buildPipeline, derivePlatformBreakdown, summarizeStudio } from '../../shared/dashboard.js';
import { readinessItems } from '../../shared/health.js';
import { AutomationView } from './automation-view.jsx';
import { DatasetsView, ReportsView } from './dataset-report-views.jsx';
import { CommandPalette, MissionCommandCenter, PaletteHint } from './mission-command.jsx';
import { RunsView, ThreadsView } from './ops-views.jsx';
import { AssetsView, KanbanView } from './pipeline-view.jsx';
import { CALENDAR, CLUSTERS, COMPETITORS, SIGNAL_FALLBACK } from './seed.js';
import { Badge, Button, Empty, formatDate, JsonBlock, StatusBanner, label, number, short, statusTone } from './ui.jsx';

const api = window.apifyStudio || null;

const NAV = [
  { id: 'dashboard', label: 'Command', group: 'Intel' },
  { id: 'signals', label: 'Signals', group: 'Intel' },
  { id: 'threads', label: 'Threads', group: 'Intel' },
  { id: 'clusters', label: 'Topic Clusters', group: 'Intel' },
  { id: 'calendar', label: 'Calendar', group: 'Planning' },
  { id: 'competitive', label: 'Competitive', group: 'Planning' },
  { id: 'assets', label: 'Asset Library', group: 'Planning' },
  { id: 'kanban', label: 'Kanban', group: 'Production' },
  { id: 'automation', label: 'Automation', group: 'Apify' },
  { id: 'runs', label: 'Runs', group: 'Apify' },
  { id: 'datasets', label: 'Datasets', group: 'Apify' },
  { id: 'reports', label: 'Reports', group: 'Codex' },
  { id: 'settings', label: 'Settings', group: 'System' },
];

const EMPTY_STATE = {
  projects: [],
  recipes: [],
  runs: [],
  datasets: [],
  analyses: [],
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
          <strong>Apify Scraper Studio hit a renderer error.</strong>
          <span>{this.state.error.message || String(this.state.error)}</span>
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

function datasetSignals(payload, dataset) {
  const items = payload?.items || [];
  if (!items.length) return SIGNAL_FALLBACK;
  return items.slice(0, 24).map((item, index) => ({
    source: item.platform || dataset?.platform || 'dataset',
    intent: item.type || 'post',
    text: item.text || item.url || item.externalId || 'Untitled item',
    author: item.author,
    heat: Math.min(99, Math.max(30, (Number(item.metrics?.likes) || 0) + (Number(item.metrics?.comments) || 0) + 40 + index)),
    url: item.url,
  }));
}

function inferLiveCluster(payload, dataset) {
  const items = payload?.items || [];
  if (!items.length) return null;
  const terms = new Map();
  for (const item of items.slice(0, 80)) {
    const words = String(item.text || '').toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || [];
    for (const word of words) {
      if (['about', 'their', 'there', 'would', 'could', 'should', 'because', 'https'].includes(word)) continue;
      terms.set(word, (terms.get(word) || 0) + 1);
    }
  }
  const topics = Array.from(terms.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
  return {
    name: `${label(dataset?.platform || 'Live')} Dataset Cluster`,
    score: Math.min(99, 55 + topics.length * 6 + Math.min(items.length, 20)),
    trend: `${number(items.length)} items`,
    owner: 'Apify live data',
    summary: dataset?.name || 'Latest normalized dataset from Apify.',
    topics: topics.length ? topics : ['fresh data', 'scraped posts', 'comments'],
    signals: ['Latest dataset', 'Normalized items', 'Ready for Codex'],
  };
}

function MetricTiles({ metrics }) {
  const tiles = [
    { name: 'Signals', value: metrics.totalItems, detail: metrics.totalItems ? 'Normalized rows ready' : 'No signals yet', icon: 'S', tone: 'signal' },
    { name: 'Recipes', value: metrics.recipes, detail: metrics.recipes ? 'Saved Apify flows' : 'No recipes yet', icon: 'R', tone: 'recipe' },
    { name: 'Datasets', value: metrics.datasets, detail: metrics.datasets ? 'Live data sources' : 'No datasets yet', icon: 'D', tone: 'dataset' },
    { name: 'Codex jobs', value: metrics.analyses, detail: metrics.analyses ? 'Analysis outputs' : 'No jobs yet', icon: 'C', tone: 'codex' },
    { name: 'Reports', value: metrics.reports, detail: metrics.reports ? 'Generated briefs' : 'No reports yet', icon: 'P', tone: 'report' },
    { name: 'Assets', value: metrics.assets, detail: metrics.assets === 1 ? '1 asset' : `${number(metrics.assets)} assets`, icon: 'A', tone: 'asset' },
    { name: 'Active', value: metrics.activeJobs, detail: metrics.activeJobs ? 'Runs in flight' : 'No active runs', icon: 'Z', tone: 'active' },
  ];
  return (
    <div className="metric-grid" aria-label="Studio metrics">
      {tiles.map((tile) => (
        <div className={`metric ${tile.tone}`} key={tile.name}>
          <div className="metric-top">
            <span>{tile.name}</span>
            <span className="metric-icon" aria-hidden="true">{tile.icon}</span>
          </div>
          <strong>{number(tile.value)}</strong>
          <small>{tile.detail}</small>
        </div>
      ))}
    </div>
  );
}

function IntentCommandPanel({ state, selectedDataset, busy, onPlanIntent, onRunIntent, onRunAction, onNavigate }) {
  const [command, setCommand] = useState('make me a lead sheet from the latest data');
  const [plan, setPlan] = useState(null);
  const intelligence = state.intelligence || {};
  const profile = intelligence.datasetProfiles?.find((item) => item.datasetId === selectedDataset?.id) || intelligence.datasetProfiles?.[0] || null;
  const setupSteps = intelligence.setupSteps || [];
  const readiness = intelligence.readiness || { percent: 0, label: 'Needs setup', detail: 'Finish setup to unlock intelligence work.', currentStep: null, nextView: 'settings' };
  const selectedDatasetKey = selectedDataset?.id || '';
  const suggestions = intelligence.suggestedCommandsByDataset?.[selectedDatasetKey] || intelligence.suggestedCommands || [];
  const workPlan = intelligence.workPlansByDataset?.[selectedDatasetKey] || intelligence.workPlan || [];
  const lastIntent = state.intentRuns?.[0] || null;

  async function planCommand(event, nextCommand = command) {
    event?.preventDefault();
    const next = await onPlanIntent(nextCommand);
    if (next) setPlan(next);
  }

  function useSuggestion(nextCommand) {
    setCommand(nextCommand);
    planCommand(null, nextCommand);
  }

  async function runCommand() {
    const result = await onRunIntent(command);
    if (result?.plan) setPlan(result.plan);
  }

  return (
    <div className="intent-command">
      <div className="intent-copy">
        <div className="intent-kicker">
          <span className={`status-dot ${profile ? 'ready' : 'warning'}`} aria-hidden="true" />
          <Badge tone={profile ? 'ready' : 'warning'}>{profile ? profile.label : 'Needs data'}</Badge>
        </div>
        <h2>Intent Command Center</h2>
        <p className="intent-brief">{intelligence.operatorBrief || 'Tell the app what outcome you want, and it will plan the local Apify plus Codex steps.'}</p>
        <form className="intent-form" onSubmit={planCommand}>
          <label className="sr-only" htmlFor="intent-command-input">Smart command</label>
          <div className="command-input-shell">
            <textarea id="intent-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="make me a lead sheet from the latest data" rows={6} />
          </div>
          <div className="button-row">
            <Button type="submit" className="plan-button" disabled={busy || !command.trim()}>Plan</Button>
            <Button type="button" className="run-button" disabled={busy || !command.trim()} onClick={runCommand}>Run plan</Button>
            <Button type="button" className="ghost" onClick={() => onNavigate('automation')}>Recipes</Button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="suggestion-rail" aria-label="Suggested smart commands">
            {suggestions.map((suggestion) => (
              <Button type="button" className="suggestion-chip" key={suggestion.id} disabled={busy} onClick={() => useSuggestion(suggestion.command)}>
                <strong>{suggestion.label}</strong>
                <span>{suggestion.detail}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="intent-panel">
        {profile ? (
          <>
            <div className="intent-stats">
              <span><strong>{number(profile.itemCount)}</strong> rows</span>
              <span><strong>{Math.round(profile.confidence * 100)}%</strong> confidence</span>
              <span><strong>{profile.health?.score ?? 0}%</strong> health</span>
              <span><strong>{profile.reportPresetId}</strong> report</span>
            </div>
            <p>{profile.summary}</p>
            {profile.health?.checks?.length > 0 && (
              <div className="quality-list">
                {profile.health.checks.map((check) => <small key={check}>{check}</small>)}
              </div>
            )}
            {profile.warnings?.length > 0 && <small>{profile.warnings.join(' ')}</small>}
          </>
        ) : (
          <SetupChecklist steps={setupSteps} readiness={readiness} onNavigate={onNavigate} />
        )}
        <ActionQueue actions={workPlan} busy={busy} onRunAction={onRunAction} onNavigate={onNavigate} />
        {plan && (
          <div className="intent-plan" aria-live="polite">
            <div>
              <strong>{plan.intent}</strong>
              <Badge tone={plan.canRun ? 'ready' : 'warning'}>{plan.canRun ? 'Runnable' : 'Needs setup'}</Badge>
            </div>
            {plan.steps.map((step) => <small key={`${step.id}-${step.action}`}>{step.label} - {step.why}</small>)}
            {plan.missing.map((item) => <small className="warning-text" key={item}>{item}</small>)}
          </div>
        )}
        {lastIntent && !plan && <small>Last smart run: {lastIntent.status} / {formatDate(lastIntent.startedAt)}</small>}
      </div>
    </div>
  );
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

function SetupChecklist({ steps, readiness, onNavigate }) {
  if (!steps?.length) {
    return <Empty title="No setup plan" detail="Refresh the workspace to rebuild the local setup checklist." />;
  }
  const percent = Math.max(0, Math.min(100, Number(readiness?.percent) || 0));
  const currentStep = readiness?.currentStep || steps.find((step) => step.status === 'current') || null;
  return (
    <div className="setup-checklist">
      <div className="readiness-head">
        <div className="readiness-title">
          <span className="readiness-orb" aria-hidden="true" />
          <div>
            <strong>Launch checklist</strong>
            <small>{readiness?.detail || (steps.every((step) => step.status === 'done') ? 'Ready for intelligence work.' : 'Finish the current step to unlock the next one.')}</small>
          </div>
        </div>
        <span className="readiness-score">{percent}%</span>
      </div>
      <div className="readiness-meter">
        <meter min="0" max="100" low="25" high="75" optimum="100" value={percent} aria-label="Workspace readiness" />
        <span>{readiness?.label || 'Needs setup'}</span>
      </div>
      {currentStep && (
        <Button type="button" className="setup-next" onClick={() => onNavigate(currentStep.view)}>
          Open {currentStep.label}
        </Button>
      )}
      <ol>
        {steps.map((step) => (
          <li className={step.status} key={step.id} aria-current={step.status === 'current' ? 'step' : undefined}>
            <span>{step.status === 'done' ? 'Done' : step.status === 'current' ? 'Now' : 'Next'}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
            {step.status !== 'done' && <Button type="button" className="ghost" aria-label={`Open ${step.label}`} onClick={() => onNavigate(step.view)}>Open</Button>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SignalList({ signals, compact = false }) {
  return (
    <div className={compact ? 'signal-list compact' : 'signal-list'}>
      {signals.map((signal, index) => (
        <article className="signal-row" key={`${signal.source}-${index}`}>
          <div className="signal-meta">
            <Badge tone={statusTone(signal.status)}>{signal.source}</Badge>
            <span>{signal.intent}</span>
            <strong>{signal.heat}</strong>
          </div>
          <p>{short(signal.text, compact ? 118 : 190)}</p>
          {signal.author && <small>{signal.author}</small>}
        </article>
      ))}
    </div>
  );
}

function DashboardView({
  state,
  meta,
  payload,
  selectedDataset,
  busy,
  onPlanIntent,
  onRunIntent,
  onRunAction,
  onRunMission,
  onRunActionGraph,
  onPauseMission,
  onScheduleMission,
  onExportMissionBundle,
  onSearchEvidence,
  onRetryJob,
  onReadJobLog,
  onNavigate,
}) {
  const metrics = summarizeStudio(state);
  const signals = datasetSignals(payload, selectedDataset).slice(0, 6);
  const pipeline = buildPipeline(state);
  const liveCluster = inferLiveCluster(payload, selectedDataset);
  const clusters = liveCluster ? [liveCluster, ...CLUSTERS.slice(0, 3)] : CLUSTERS.slice(0, 4);

  return (
    <section className="dashboard-grid">
      <div className="panel span-two v5-dashboard-panel">
        <MissionCommandCenter
          state={state}
          selectedDataset={selectedDataset}
          busy={busy}
          onRunMission={onRunMission}
          onRunActionGraph={onRunActionGraph}
          onPauseMission={onPauseMission}
          onScheduleMission={onScheduleMission}
          onExportMissionBundle={onExportMissionBundle}
          onSearchEvidence={onSearchEvidence}
          onRetryJob={onRetryJob}
          onReadJobLog={onReadJobLog}
          onNavigate={onNavigate}
        />
      </div>
      <div className="panel command-hero">
        <IntentCommandPanel state={state} selectedDataset={selectedDataset} busy={busy} onPlanIntent={onPlanIntent} onRunIntent={onRunIntent} onRunAction={onRunAction} onNavigate={onNavigate} />
      </div>
      <MetricTiles metrics={metrics} />
      <div className="panel span-two">
        <div className="panel-head">
          <div><h3>Live Signal Intelligence</h3><p>{selectedDataset?.name || 'Fallback market model until Apify data lands.'}</p></div>
          <Button className="ghost" onClick={() => onNavigate('signals')}>Inspect</Button>
        </div>
        <SignalList signals={signals} compact />
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Topic Clusters</h3><Button className="ghost" onClick={() => onNavigate('clusters')}>Open</Button></div>
        <div className="cluster-stack">
          {clusters.map((cluster) => <ClusterCard cluster={cluster} compact key={cluster.name} />)}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Workflow Pipeline</h3><small>{meta?.dataRoot}</small></div>
        <div className="pipeline">
          {pipeline.map((stage) => (
            <article className="pipeline-stage" key={stage.id}>
              <Badge tone={stage.tone}>{stage.title}</Badge>
              <strong>{number(stage.count)}</strong>
              <p>{stage.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignalsView({ payload, selectedDataset, state, onDatasetSelect, onNavigate }) {
  const [query, setQuery] = useState('');
  const allSignals = datasetSignals(payload, selectedDataset);
  const filtered = allSignals.filter((signal) => `${signal.source} ${signal.intent} ${signal.text} ${signal.author || ''}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="view-grid signals-view">
      <div className="panel side-panel">
        <h3>Datasets</h3>
        <div className="stack">
          {state.datasets.map((dataset) => (
            <button className={`dataset-button ${dataset.id === selectedDataset?.id ? 'active' : ''}`} key={dataset.id} onClick={() => onDatasetSelect(dataset.id)}>
              <strong>{dataset.name}</strong>
              <small>{dataset.platform} - {number(dataset.itemCount)} items</small>
            </button>
          ))}
          {!state.datasets.length && <Empty title="No Apify datasets yet" detail="Create a recipe, run it, then signals will appear here." action="Create recipe" onAction={() => onNavigate('automation')} />}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div><h3>Signal Feed</h3><p>Posts, comments, accounts, and threads normalized into one review queue.</p></div>
          <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search signals, authors, platforms" />
        </div>
        <SignalList signals={filtered} />
      </div>
    </section>
  );
}

function ClusterCard({ cluster, compact = false }) {
  return (
    <article className={compact ? 'cluster-card compact' : 'cluster-card'}>
      <div className="cluster-top">
        <div>
          <strong>{cluster.name}</strong>
          <span>{cluster.owner}</span>
        </div>
        <div className="cluster-score">{cluster.score}</div>
      </div>
      <p>{cluster.summary}</p>
      <div className="chip-row">
        {cluster.topics.map((topic) => <span className="chip" key={topic}>{topic}</span>)}
      </div>
      {!compact && <small>{cluster.signals.join(' / ')} - {cluster.trend}</small>}
    </article>
  );
}

function ClustersView({ payload, selectedDataset }) {
  const liveCluster = inferLiveCluster(payload, selectedDataset);
  const clusters = liveCluster ? [liveCluster, ...CLUSTERS] : CLUSTERS;
  return (
    <section className="panel full">
      <div className="panel-head">
        <div><h3>Topic Clusters</h3><p>Thinklet-style strategic themes, now fed by Apify datasets and Codex tags.</p></div>
        <Badge tone="ready">{clusters.length} active</Badge>
      </div>
      <div className="cluster-grid">
        {clusters.map((cluster) => <ClusterCard cluster={cluster} key={cluster.name} />)}
      </div>
    </section>
  );
}

function CalendarView({ state, onNavigate }) {
  const dynamic = state.datasets.slice(0, 3).map((dataset, index) => ({
    date: ['Today', 'Next', 'Review'][index] || 'Next',
    title: dataset.name,
    channel: dataset.platform,
    status: dataset.itemCount ? 'Needs tags' : 'Queued',
  }));
  const events = dynamic.length ? [...dynamic, ...CALENDAR] : CALENDAR;

  return (
    <section className="panel full">
      <div className="panel-head">
        <div><h3>Content Calendar</h3><p>Signals become report beats, lead lists, social angles, and campaign briefs.</p></div>
        <Button onClick={() => onNavigate('reports')}>Generate report</Button>
      </div>
      <div className="calendar-grid">
        {events.map((event, index) => (
          <article className="calendar-card" key={`${event.title}-${index}`}>
            <span>{event.date}</span>
            <strong>{event.title}</strong>
            <div><Badge>{event.channel}</Badge><Badge tone={statusTone(event.status)}>{event.status}</Badge></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CompetitiveView({ state }) {
  const platforms = derivePlatformBreakdown(state.datasets);
  return (
    <section className="view-grid">
      <div className="panel">
        <h3>Competitive Intel</h3>
        <div className="competitor-list">
          {COMPETITORS.map((competitor) => (
            <article className="competitor" key={competitor.name}>
              <div><strong>{competitor.name}</strong><span>{competitor.channel}</span></div>
              <meter value={competitor.share} min="0" max="40" />
              <p>{competitor.move}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Apify Coverage</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Platform</th><th>Datasets</th><th>Signals</th></tr></thead>
            <tbody>
              {platforms.map((row) => <tr key={row.platform}><td>{row.platform}</td><td>{row.datasets}</td><td>{number(row.items)}</td></tr>)}
            </tbody>
          </table>
        </div>
        {!platforms.length && <Empty title="No platform coverage yet" detail="Run Reddit, X, LinkedIn, or any configured Actor task to populate this view." />}
      </div>
    </section>
  );
}

function SettingsView({ state, meta, busy, onSaveKey, onClearKey, onSaveSettings, onTestSheetsBridge, onArchiveAndClearSheets, onImportWorkingSheets, onReplaySheetRun, onCheckCodex, onOpenDataFolder, onOpenWorkspace }) {
  const [token, setToken] = useState('');
  const [sheetWebhook, setSheetWebhook] = useState('');
  const [maxItems, setMaxItems] = useState(state.settings.maxItems || 1000);
  const [sheetForm, setSheetForm] = useState({
    workingSpreadsheetUrl: state.settings.sheets?.workingSpreadsheetUrl || '',
    archiveFolderId: state.settings.sheets?.archiveFolderId || '',
    twitterTab: state.settings.sheets?.twitterTab || 'Twitter',
    linkedinTab: state.settings.sheets?.linkedinTab || 'LinkedIn',
    redditTab: state.settings.sheets?.redditTab || 'Reddit',
  });
  const [codex, setCodex] = useState(null);
  const [checkingCodex, setCheckingCodex] = useState(false);

  useEffect(() => setMaxItems(state.settings.maxItems || 1000), [state.settings.maxItems]);
  useEffect(() => {
    setSheetForm({
      workingSpreadsheetUrl: state.settings.sheets?.workingSpreadsheetUrl || '',
      archiveFolderId: state.settings.sheets?.archiveFolderId || '',
      twitterTab: state.settings.sheets?.twitterTab || 'Twitter',
      linkedinTab: state.settings.sheets?.linkedinTab || 'LinkedIn',
      redditTab: state.settings.sheets?.redditTab || 'Reddit',
    });
  }, [
    state.settings.sheets?.workingSpreadsheetUrl,
    state.settings.sheets?.archiveFolderId,
    state.settings.sheets?.twitterTab,
    state.settings.sheets?.linkedinTab,
    state.settings.sheets?.redditTab,
  ]);

  function updateSheetField(key, value) {
    setSheetForm((current) => ({ ...current, [key]: value }));
  }

  async function checkCodex() {
    setCheckingCodex(true);
    try {
      setCodex(await onCheckCodex());
    } catch (err) {
      setCodex({ ok: false, error: err.message || String(err) });
    } finally {
      setCheckingCodex(false);
    }
  }

  return (
    <section className="panel full settings-view">
      <div className="panel-head">
        <div><h3>Settings</h3><p>Secrets stay in Electron safeStorage and are redacted before Codex sees data.</p></div>
        <div className="button-row">
          <Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys.APIFY_API_TOKEN ? 'Apify saved' : 'Apify missing'}</Badge>
          <Badge tone={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'ready' : 'warning'}>{state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Sheets saved' : 'Sheets missing'}</Badge>
        </div>
      </div>
      <div className="readiness-grid">
        {readinessItems(state, meta, codex).map((item) => (
          <article className="readiness-card" key={item.id}>
            <Badge tone={item.tone}>{item.label}</Badge>
            <p>{short(item.detail, 160)}</p>
          </article>
        ))}
      </div>
      <div className="field-grid two">
        <label>APIFY_API_TOKEN
          <div className="inline">
            <input type="password" value={token} placeholder={state.keys.APIFY_API_TOKEN ? 'Saved in keychain' : 'Paste token'} onChange={(event) => setToken(event.target.value)} />
            <Button disabled={busy || !token} onClick={() => { onSaveKey('APIFY_API_TOKEN', token); setToken(''); }}>Save</Button>
            <Button className="ghost" disabled={busy} onClick={() => onClearKey('APIFY_API_TOKEN')}>Clear</Button>
          </div>
        </label>
        <label>Max items per Apify run
          <div className="inline">
            <input type="number" min="1" max="10000" value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
            <Button disabled={busy} onClick={() => onSaveSettings({ maxItems })}>Save</Button>
          </div>
        </label>
        <label>Codex CLI
          <div className="inline">
            <input readOnly value={codex?.ok ? codex.version || 'Codex available' : codex?.error || 'Not checked'} />
            <Button disabled={busy || checkingCodex} onClick={checkCodex}>{checkingCodex ? 'Checking' : 'Check'}</Button>
          </div>
        </label>
      </div>
      <div className="settings-block">
        <div className="panel-head compact">
          <div><h3>Google Sheets bridge</h3><p>Use an Apps Script webhook to archive, clear, import, and write shared weekly sheets.</p></div>
        </div>
        <div className="field-grid two">
          <label>GOOGLE_SHEETS_WEBHOOK_URL
            <div className="inline">
              <input type="password" value={sheetWebhook} placeholder={state.keys.GOOGLE_SHEETS_WEBHOOK_URL ? 'Saved in keychain' : 'Paste Apps Script web app URL'} onChange={(event) => setSheetWebhook(event.target.value)} />
              <Button disabled={busy || !sheetWebhook} onClick={() => { onSaveKey('GOOGLE_SHEETS_WEBHOOK_URL', sheetWebhook); setSheetWebhook(''); }}>Save</Button>
              <Button className="ghost" disabled={busy} onClick={() => onClearKey('GOOGLE_SHEETS_WEBHOOK_URL')}>Clear</Button>
            </div>
          </label>
          <label>Working spreadsheet URL
            <input value={sheetForm.workingSpreadsheetUrl} onChange={(event) => updateSheetField('workingSpreadsheetUrl', event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          </label>
          <label>Archive folder ID
            <input value={sheetForm.archiveFolderId} onChange={(event) => updateSheetField('archiveFolderId', event.target.value)} placeholder="Google Drive folder ID" />
          </label>
          <label>Twitter tab
            <input value={sheetForm.twitterTab} onChange={(event) => updateSheetField('twitterTab', event.target.value)} />
          </label>
          <label>LinkedIn tab
            <input value={sheetForm.linkedinTab} onChange={(event) => updateSheetField('linkedinTab', event.target.value)} />
          </label>
          <label>Reddit tab
            <input value={sheetForm.redditTab} onChange={(event) => updateSheetField('redditTab', event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <Button disabled={busy} onClick={() => onSaveSettings({ sheets: sheetForm })}>Save sheet settings</Button>
          <Button className="ghost" disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId} onClick={onTestSheetsBridge}>Test bridge</Button>
          <Button
            className="ghost"
            disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId}
            onClick={() => {
              if (window.confirm('Clone the working spreadsheet to archive, then clear the configured working tabs?')) onArchiveAndClearSheets({});
            }}
          >
            Archive + clear
          </Button>
          <Button className="ghost" disabled={busy || !state.keys.GOOGLE_SHEETS_WEBHOOK_URL || !state.settings.sheets?.workingSpreadsheetId} onClick={onImportWorkingSheets}>Pull working sheet</Button>
        </div>
        {state.sheetRuns?.length > 0 && (
          <div className="stack">
            {state.sheetRuns.slice(0, 3).map((run) => (
              <article className="readiness-card" key={run.id}>
                <Badge tone={statusTone(run.status)}>{run.kind}</Badge>
                <p>{short(run.error || run.archiveUrl || run.tabName || run.datasetId || run.spreadsheetId || 'Sheet run saved', 160)}</p>
                {run.status === 'failed' && (
                  <Button
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (run.kind === 'archive-clear' && !window.confirm('Replay archive + clear for this failed sheet run?')) return;
                      onReplaySheetRun(run.id);
                    }}
                  >
                    Replay
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="button-row">
        <Button className="ghost" disabled={busy} onClick={onOpenDataFolder}>Open data folder</Button>
        <Button className="ghost" disabled={busy} onClick={onOpenWorkspace}>Open workspace</Button>
      </div>
      <JsonBlock value={{ app: meta?.name, version: meta?.version, dataRoot: meta?.dataRoot }} />
    </section>
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
          {job.cancellable && <Button className="ghost danger" disabled={busy} onClick={() => onCancelJob(job.id)}>Cancel</Button>}
        </div>
      ))}
    </div>
  );
}

function Header({ active, busy, error, notice, state, onRefresh, onCancelJob, onOpenPalette }) {
  const item = NAV.find((nav) => nav.id === active);
  const metrics = summarizeStudio(state);
  return (
    <header className="topbar">
      <div>
        <span>{item?.group || 'Workspace'}</span>
        <h1>{item?.label || 'Command'}</h1>
      </div>
      <div className="topbar-right">
        <StatusBanner error={error} notice={notice} />
        <JobTray jobs={state.jobs || []} busy={busy} onCancelJob={onCancelJob} />
        {busy && <Badge tone="running">Working</Badge>}
        <Badge tone={metrics.apifyConnected ? 'ready' : 'warning'}>{metrics.apifyConnected ? 'Apify' : 'No token'}</Badge>
        <PaletteHint onOpen={onOpenPalette} />
        <Button className="ghost" onClick={onRefresh}>Refresh</Button>
      </div>
    </header>
  );
}

function MobileNav({ active, onNavigate }) {
  return (
    <div className="mobile-nav">
      <label>
        View
        <select value={active} onChange={(event) => onNavigate(event.target.value)}>
          {NAV.map((item) => <option key={item.id} value={item.id}>{item.group} / {item.label}</option>)}
        </select>
      </label>
    </div>
  );
}

export default function App() {
  if (!api) return <ApiUnavailable />;

  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(EMPTY_STATE);
  const [active, setActive] = useState('dashboard');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [payload, setPayload] = useState(null);
  const datasetKey = state.datasets.map((dataset) => `${dataset.id}:${dataset.itemCount}:${dataset.createdAt}`).join('|');

  async function refresh() {
    setMeta(await api.appMeta());
    setState(await api.state());
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message || String(err)));
    return api.onStateChanged((next) => setState(next));
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const datasetId = selectedDatasetId || state.datasets[0]?.id || '';
    if (!datasetId) {
      setPayload(null);
      return;
    }
    if (datasetId !== selectedDatasetId) setSelectedDatasetId(datasetId);
    api.readDataset(datasetId).then((nextPayload) => {
      if (!cancelled) setPayload(nextPayload);
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
    setBusy(true);
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
      setBusy(false);
    }
  }

  const selectedDataset = useMemo(
    () => state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0] || null,
    [state.datasets, selectedDatasetId],
  );

  function navigate(view, args = {}) {
    if (args.datasetId) setSelectedDatasetId(args.datasetId);
    setActive(view);
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
    if (active === 'signals') return <SignalsView {...common} payload={payload} selectedDataset={selectedDataset} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} />;
    if (active === 'threads') {
      return (
        <ThreadsView
          {...common}
          payload={payload}
          selectedDataset={selectedDataset}
          onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)}
          onOpenAnalysisOutput={(analysisId) => runAction(() => api.openAnalysisOutput(analysisId), 'Analysis output opened.')}
          onRevealAnalysisOutput={(analysisId) => runAction(() => api.revealAnalysisOutput(analysisId), 'Analysis output revealed in Finder.')}
          onAnalyze={(datasetId, kind) => runAction(() => api.analyzeDataset({ datasetId, kind }), 'Thread analysis complete.')}
        />
      );
    }
    if (active === 'clusters') return <ClustersView payload={payload} selectedDataset={selectedDataset} />;
    if (active === 'calendar') return <CalendarView state={state} onNavigate={navigate} />;
    if (active === 'competitive') return <CompetitiveView state={state} />;
    if (active === 'assets') {
      return (
        <AssetsView
          state={state}
          onNavigate={navigate}
          onOpenAssetsFolder={() => runAction(() => api.openAssetsFolder(), 'Assets folder opened.')}
          onOpenAsset={(assetId) => runAction(() => api.openAsset(assetId), 'Asset opened.')}
          onRevealAsset={(assetId) => runAction(() => api.revealAsset(assetId), 'Asset revealed in Finder.')}
          onExportAssetPack={(payload) => runAction(() => api.exportAssetPack(payload), (result) => `Exported ${result.assetCount} assets.`)}
          onSaveAsset={(asset) => runAction(() => api.saveAsset(asset), 'Asset saved.')}
          onCreateCardFromAsset={(card) => runAction(() => api.saveCard(card), 'Card created from asset.')}
        />
      );
    }
    if (active === 'kanban') {
      return (
        <KanbanView
          {...common}
          selectedDataset={selectedDataset}
          onMoveCard={(payload) => runAction(() => api.moveCard(payload), 'Card moved.')}
          onSaveCard={(card) => runAction(() => api.saveCard(card), 'Card saved.', true)}
          onGenerateAssets={(payload) => runAction(() => api.generateAssets(payload), 'Asset pack generated.')}
          onNavigate={navigate}
        />
      );
    }
    if (active === 'automation') {
      return (
        <AutomationView
          {...common}
          onSaveRecipe={(recipe) => runAction(() => api.saveRecipe(recipe), 'Recipe saved.')}
          onRunRecipe={(recipeId) => runAction(() => api.runRecipe(recipeId), 'Apify run complete.')}
          onDeleteRecipe={(recipeId) => runAction(() => api.deleteRecipe(recipeId), 'Recipe deleted.')}
          onDiscoverApifyResource={(payload) => api.discoverApifyResource(payload)}
          onTestRecipe={(recipe) => api.testRecipe(recipe)}
          onSaveRecipeVersion={(payload) => runAction(() => api.saveRecipeVersion(payload), 'Recipe version saved.')}
        />
      );
    }
    if (active === 'runs') return <RunsView {...common} onRunRecipe={(recipeId) => runAction(() => api.runRecipe(recipeId), 'Apify run complete.')} onDatasetSelect={setSelectedDatasetId} onNavigate={navigate} />;
    if (active === 'datasets') {
      return (
        <DatasetsView
          {...common}
          selectedDatasetId={selectedDatasetId}
          onDatasetSelect={setSelectedDatasetId}
          payload={payload}
          onNavigate={navigate}
          onSearchEvidence={(query) => api.searchEvidence(query)}
          onAnalyze={(datasetId, kind, options = {}) => runAction(() => api.analyzeDataset({ datasetId, kind, ...options }), 'Codex analysis complete.')}
          onExportDataset={(datasetId, format) => runAction(() => api.exportDataset({ datasetId, format }), (result) => `Exported ${result.itemCount} rows to ${result.format.toUpperCase()}.`)}
          onExportDatasetToSheets={(datasetId) => runAction(() => api.exportDatasetToSheets({ datasetId }), (result) => `Wrote ${number(result.rowCount || 0)} rows to ${result.tabName || 'Sheets'}.`)}
        />
      );
    }
    if (active === 'reports') {
      return (
        <ReportsView
          {...common}
          selectedDatasetId={selectedDatasetId}
          onDatasetSelect={setSelectedDatasetId}
          onReadAnalysis={(analysisId) => api.readAnalysis(analysisId)}
          onAnalyze={(datasetId, kind, options = {}) => runAction(() => api.analyzeDataset({ datasetId, kind, ...options }), 'Codex analysis complete.')}
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
          onSaveKey={(keyName, value) => runAction(() => api.saveKey(keyName, value), 'Token saved.')}
          onClearKey={(keyName) => runAction(() => api.clearKey(keyName), 'Token cleared.')}
          onSaveSettings={(settings) => runAction(() => api.saveSettings(settings), 'Settings saved.')}
          onTestSheetsBridge={() => runAction(() => api.testSheetsBridge(), 'Sheets bridge reachable.')}
          onArchiveAndClearSheets={(payload) => runAction(() => api.archiveAndClearSheets(payload), 'Working sheet archived and cleared.')}
          onImportWorkingSheets={() => runAction(() => api.importWorkingSheets(), 'Working sheet imported.')}
          onReplaySheetRun={(sheetRunId) => runAction(() => api.replaySheetRun(sheetRunId), 'Sheet run replayed.')}
          onCheckCodex={() => api.checkCodex()}
          onOpenDataFolder={() => runAction(() => api.openDataFolder(), 'Data folder opened.')}
          onOpenWorkspace={() => runAction(() => api.openWorkspace('default'), 'Workspace opened.')}
        />
      );
    }
    return (
      <DashboardView
        state={state}
        meta={meta}
        payload={payload}
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
  }, [active, state, meta, busy, selectedDatasetId, payload, selectedDataset]);

  const groupedNav = NAV.reduce((groups, item) => {
    groups[item.group] = [...(groups[item.group] || []), item];
    return groups;
  }, {});

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span>AS</span>
            <div><strong>Apify Scraper Studio</strong><small>Golden Thread Mac</small></div>
          </div>
          <nav aria-label="Primary">
            {Object.entries(groupedNav).map(([group, items]) => (
              <div className="nav-group" key={group}>
                <small>{group}</small>
                {items.map((item) => (
                  <Button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => setActive(item.id)}>{item.label}</Button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <Badge tone={state.keys.APIFY_API_TOKEN ? 'ready' : 'warning'}>{state.keys.APIFY_API_TOKEN ? 'Connected' : 'Setup'}</Badge>
            <span>{state.jobs.length ? `${state.jobs.length} active job` : 'Idle workspace'}</span>
          </div>
        </aside>
        <main className="workspace">
          <Header
            active={active}
            busy={busy}
            error={error}
            notice={notice}
            state={state}
            onRefresh={() => runAction(refresh)}
            onCancelJob={(jobId) => runAction(() => api.cancelJob(jobId), 'Job cancelled.')}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <MobileNav active={active} onNavigate={setActive} />
          <div className="content">{content}</div>
          <CommandPalette
            open={paletteOpen}
            items={state.v5?.commandPalette || []}
            onClose={() => setPaletteOpen(false)}
            onRun={runPaletteItem}
          />
        </main>
      </div>
    </ErrorBoundary>
  );
}
