import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  Boxes,
  CalendarClock,
  Command,
  Database,
  FileText,
  FileSearch,
  FolderArchive,
  Gauge,
  PackageCheck,
  Pause,
  Play,
  Rocket,
  Search,
  TerminalSquare,
} from 'lucide-react';
import { buildActionGraph } from './v5-ui-core.js';
import { Badge, Button, Empty, number, short, statusTone } from './ui.jsx';

function activeMission(v5 = {}) {
  return v5.missions?.find((mission) => mission.id === v5.activeMissionId) || v5.missions?.[0] || null;
}

function IconTile({ icon: Icon, tone = '' }) {
  return <span className={`v5-icon ${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>;
}

function Stat({ icon, label, value, detail, tone }) {
  return (
    <article className="v5-stat">
      <IconTile icon={icon} tone={tone} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export function CommandPalette({ open, items = [], onClose, onRun }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const visible = items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIndex = Math.min(activeIndex, visible.length - 1);
  // Enter runs the first match before any arrow key, so show that row as chosen from the start.
  const highlightedIndex = Math.max(0, selectedIndex);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    setQuery('');
    setActiveIndex(-1);
    inputRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  function runItem(item) {
    if (!item) return;
    onRun(item);
    onClose();
  }

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const buttons = Array.from(dialogRef.current?.querySelectorAll('[data-palette-command]') || []);
    if (event.key === 'Tab') {
      event.preventDefault();
      const controls = [inputRef.current, ...buttons].filter(Boolean);
      const current = controls.indexOf(document.activeElement);
      const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visible.length) return;
      const next = event.key === 'ArrowDown'
        ? (selectedIndex + 1) % visible.length
        : (selectedIndex <= 0 ? visible.length - 1 : selectedIndex - 1);
      setActiveIndex(next);
      buttons[next]?.focus();
      buttons[next]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runItem(visible[Math.max(0, selectedIndex)]);
      return;
    }
    // Typing while a result is focused keeps refining the search instead of being lost.
    if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && document.activeElement !== inputRef.current) {
      inputRef.current?.focus();
    }
  }

  if (!open) return null;
  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} aria-label="Search commands" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }} placeholder="Search pages and actions…" />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" aria-label="Matching commands">
          {visible.map((item, index) => { const Icon = item.icon || Command; return (
            <button type="button" data-palette-command="" className={index === highlightedIndex ? 'active' : ''} key={item.id} onFocus={() => setActiveIndex(index)} onMouseMove={() => index !== selectedIndex && setActiveIndex(index)} onClick={() => runItem(item)}>
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
              <kbd aria-hidden="true">↵</kbd>
            </button>
          ); })}
          {!visible.length && <Empty title="No commands" detail="Try another page or action." />}
        </div>
      </section>
    </div>
  );
}

function ActionGraphPreview({ mission, state, selectedDataset, busy, onRunActionGraph }) {
  const baseGraph = useMemo(() => buildActionGraph(mission?.goal || mission?.name || 'run the best mission loop', {
    ...state,
    selectedDatasetId: selectedDataset?.id || '',
  }), [mission?.goal, mission?.name, selectedDataset?.id, state]);
  const [graph, setGraph] = useState(baseGraph);
  const [argsText, setArgsText] = useState({});
  const [graphError, setGraphError] = useState('');

  useEffect(() => {
    setGraph(baseGraph);
    setArgsText(Object.fromEntries((baseGraph.steps || []).map((step) => [step.id, JSON.stringify(step.args || {}, null, 2)])));
    setGraphError('');
  }, [baseGraph]);

  function updateStep(stepId, patch) {
    setGraph((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }

  function moveStep(stepId, direction) {
    setGraph((current) => {
      const steps = [...current.steps];
      const index = steps.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= steps.length) return current;
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      return { ...current, steps };
    });
  }

  function runEditedGraph() {
    try {
      const steps = graph.steps.map((step) => ({ ...step, args: JSON.parse(argsText[step.id] || '{}') }));
      setGraphError('');
      onRunActionGraph({ ...graph, steps, canRun: steps.length > 0, missing: [] });
    } catch (error) {
      setGraphError(error.message || String(error));
    }
  }

  return (
    <div className="v5-action-graph">
      <div className="v5-section-head">
        <div>
          <strong>Step-by-step plan</strong>
          <small>{graph.canRun ? `${graph.steps.length} runnable steps` : graph.missing.join(' ') || 'Needs setup'}</small>
        </div>
        <Badge tone={graph.canRun ? 'ready' : 'warning'}>{graph.canRun ? 'Runnable' : 'Blocked'}</Badge>
      </div>
      <ol>
        {graph.steps.map((step, index) => (
          <li key={`${step.id}-${index}`}>
            <span>{index + 1}</span>
            <div>
              <input value={step.label} onChange={(event) => updateStep(step.id, { label: event.target.value })} aria-label={`${step.action} label`} />
              <small>{step.action}</small>
              <textarea
                value={argsText[step.id] ?? JSON.stringify(step.args || {}, null, 2)}
                onChange={(event) => setArgsText((current) => ({ ...current, [step.id]: event.target.value }))}
                rows="3"
                aria-label={`${step.action} args JSON`}
              />
              <div className="button-row">
                <Button type="button" className="ghost" disabled={index === 0} onClick={() => moveStep(step.id, -1)}>Up</Button>
                <Button type="button" className="ghost" disabled={index === graph.steps.length - 1} onClick={() => moveStep(step.id, 1)}>Down</Button>
                <Button type="button" className="ghost danger" onClick={() => setGraph((current) => ({ ...current, steps: current.steps.filter((item) => item.id !== step.id) }))}>Remove</Button>
              </div>
            </div>
            <Badge>{step.editable ? 'Edit' : 'Fixed'}</Badge>
          </li>
        ))}
      </ol>
      {graphError && <p className="field-error" role="alert">{graphError}</p>}
      <Button disabled={busy || !graph.steps.length} onClick={runEditedGraph}><Play size={16} aria-hidden="true" /> Run edited graph</Button>
      {!graph.steps.length && <Empty title="No graph yet" detail="Save a recipe or run a dataset to unlock mission planning." />}
    </div>
  );
}

function EvidencePanel({ v5, busy, onSearchEvidence }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const sample = results || v5.evidenceSummary?.sample || [];
  async function search(event) {
    event.preventDefault();
    const next = await onSearchEvidence({ query, limit: 8 });
    setResults(next || []);
  }
  return (
    <div className="v5-evidence">
      <div className="v5-section-head">
        <div>
          <strong>Evidence graph</strong>
          <small>{number(v5.evidenceSummary?.total)} source-backed records</small>
        </div>
        <IconTile icon={FileSearch} tone="blue" />
      </div>
      <form className="v5-search" onSubmit={search}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search evidence, URLs, authors, claims" />
        <Button disabled={busy}>Search</Button>
      </form>
      <div className="v5-evidence-list">
        {sample.map((item) => (
          <article key={item.id}>
            <strong>{short(item.text || item.sourceUrl || item.id, 120)}</strong>
            <small>{item.sourceUrl || item.author || item.datasetId}</small>
          </article>
        ))}
        {!sample.length && <Empty title="No evidence yet" detail="Run a recipe to index source-backed rows." />}
      </div>
    </div>
  );
}

function JobLedger({ v5, busy, onRetryJob, onReadJobLog }) {
  const jobs = v5.jobs || [];
  const [log, setLog] = useState('');
  return (
    <div className="v5-job-ledger">
      <div className="v5-section-head">
        <div>
          <strong>Job history</strong>
          <small>{jobs.length ? `${jobs.length} attempts recorded` : 'No V5 mission jobs yet'}</small>
        </div>
        <IconTile icon={TerminalSquare} tone="green" />
      </div>
      <div className="v5-job-list">
        {jobs.slice(0, 5).map((job) => (
          <article key={job.id}>
            <Badge tone={statusTone(job.status)}>{job.status}</Badge>
            <div>
              <strong>{job.title}</strong>
              <small>{job.kind} / attempt {job.attempts || 1}</small>
              <div className="button-row">
                {job.status === 'failed' && <Button className="ghost" disabled={busy} onClick={() => onRetryJob(job.id)}>Retry</Button>}
                <Button className="ghost" disabled={busy} onClick={async () => setLog(await onReadJobLog(job.id))}>Log</Button>
              </div>
            </div>
          </article>
        ))}
        {!jobs.length && <Empty title="No mission jobs" detail="Run a mission to create persistent job history." />}
      </div>
      {log && <pre className="v5-job-log">{short(log, 2000)}</pre>}
    </div>
  );
}

function ArtifactStrip({ assets = [], onNavigate }) {
  return (
    <div className="v5-artifacts">
      <div className="v5-section-head">
        <div>
          <strong>Artifact studio</strong>
          <small>{assets.length ? `${assets.length} local assets` : 'Reports and assets land here'}</small>
        </div>
        <Button className="ghost" onClick={() => onNavigate('assets')}>Open</Button>
      </div>
      <div className="v5-artifact-strip">
        {assets.slice(0, 4).map((asset) => (
          <article key={asset.id}>
            <Badge tone={statusTone(asset.status)}>{asset.status || 'draft'}</Badge>
            <strong>{asset.title}</strong>
            <small>{asset.channel || asset.assetType || 'artifact'}</small>
          </article>
        ))}
        {!assets.length && <Empty title="No artifacts" detail="Generate assets from a card or mission." />}
      </div>
    </div>
  );
}

export function MissionCommandCenter({
  state,
  selectedDataset,
  busy,
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
  const v5 = state.v5 || {};
  const mission = activeMission(v5);
  const observability = v5.observability || {};
  const release = v5.release || {};
  const schedule = mission ? v5.schedules?.[mission.id] : null;
  const onboarding = v5.onboarding || {};
  if (!mission) {
    return (
      <section className="v5-command-shell">
        <Empty title="No mission yet" detail="Create or import a mission to turn this workspace into a V5 intelligence loop." />
      </section>
    );
  }
  return (
    <section className="v5-command-shell" aria-label="Mission Command">
      <div className="v5-hero">
        <div>
          <div className="v5-kicker"><IconTile icon={Rocket} tone="lime" /><Badge tone="ready">Workflow control</Badge></div>
          <h2>{mission.name}</h2>
          <p>{mission.goal || mission.description}</p>
        </div>
        <div className="v5-hero-actions">
          <Button disabled={busy} onClick={() => onRunMission(mission.id)}><Play size={16} aria-hidden="true" /> Run mission</Button>
          <Button className="ghost" disabled={busy} onClick={() => onScheduleMission({ missionId: mission.id, schedule: { cadence: 'weekly', timezone: 'America/New_York', quiet: true, threshold: 5 } })}><CalendarClock size={16} aria-hidden="true" /> Watch weekly</Button>
          <Button className="ghost" disabled={busy} onClick={() => onPauseMission(mission.id)}><Pause size={16} aria-hidden="true" /> Pause</Button>
          <Button className="ghost" disabled={busy} onClick={() => onExportMissionBundle(mission.id)}><FolderArchive size={16} aria-hidden="true" /> Bundle</Button>
        </div>
      </div>
      <div className="v5-stat-grid">
        <Stat icon={Database} label="Evidence" value={number(v5.evidenceSummary?.total)} detail="Indexed records" tone="blue" />
        <Stat icon={Activity} label="Runs" value={number(observability.totalRuns)} detail={`${observability.failureRate || 0}% fail rate`} tone="green" />
        <Stat icon={Gauge} label="Yield" value={number(observability.totalItems)} detail={`${observability.avgItemsPerRun || 0} avg/run`} tone="lime" />
        <Stat icon={FileText} label="Evals" value={`${number(v5.evals?.passed)}/${number(v5.evals?.total)}`} detail={`${v5.evals?.avgScore || 0}/100 avg`} tone="blue" />
      </div>
      <div className="v5-main-grid">
        <ActionGraphPreview mission={mission} state={state} selectedDataset={selectedDataset} busy={busy} onRunActionGraph={onRunActionGraph} />
        <EvidencePanel v5={v5} busy={busy} onSearchEvidence={onSearchEvidence} />
        <JobLedger v5={v5} busy={busy} onRetryJob={onRetryJob} onReadJobLog={onReadJobLog} />
        <ArtifactStrip assets={state.assets || []} onNavigate={onNavigate} />
      </div>
      <div className="v5-footer-grid">
        <article>
          <IconTile icon={CalendarClock} tone="green" />
          <div><strong>Watch loop</strong><small>{schedule ? `${schedule.cadence}, quiet=${schedule.quiet ? 'yes' : 'no'}, threshold ${schedule.threshold}` : 'No schedule yet'}</small></div>
        </article>
        <article>
          <IconTile icon={PackageCheck} tone="blue" />
          <div><strong>App updates</strong><small>{release.notarization?.status || 'unknown'} / update {release.update?.status || 'unknown'}</small></div>
        </article>
        <article>
          <IconTile icon={Boxes} tone="lime" />
          <div><strong>Presets</strong><small>{number(v5.missionPresets?.length)} productized loops available</small></div>
        </article>
        <article>
          <IconTile icon={Archive} tone="amber" />
          <div><strong>Onboarding</strong><small>{onboarding.next ? `Next: ${onboarding.next.label}` : `${number(onboarding.done)}/${number(onboarding.total)} complete`}</small></div>
        </article>
      </div>
    </section>
  );
}

export function PaletteHint({ onOpen }) {
  return (
    <Button className="ghost palette-trigger" onClick={onOpen}>
      <Command size={16} aria-hidden="true" /> Cmd K
    </Button>
  );
}
