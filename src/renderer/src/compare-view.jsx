import React, { useRef, useState } from 'react';
import { ArrowRight, CalendarClock, CheckCircle2, GitCompareArrows, History, RefreshCw } from 'lucide-react';
import './compare-view.css';
import { datasetLabel } from './ui.jsx';

function dateLabel(value) {
  if (!value) return 'Capture date unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : value;
}
const labels = { changed: 'Changed', unchanged: 'Unchanged', new: 'New in this snapshot', unavailable: 'Unavailable' };

export function CompareView({ state = {}, busy = false, onCompare, onSaveMonitor, onNavigate, selectedDatasetId = '', baselineDatasetId = '', currentDatasetId = '' }) {
  const datasets = state.datasets || [];
  const recipes = state.recipes || [];
  const initialCurrent = currentDatasetId || selectedDatasetId || datasets[0]?.id || '';
  const initialRecipe = datasets.find((dataset) => dataset.id === initialCurrent)?.recipeId || '';
  const [currentId, setCurrentId] = useState(initialCurrent);
  const [baselineId, setBaselineId] = useState(baselineDatasetId || datasets.find((dataset) => dataset.id !== initialCurrent && (!initialRecipe || dataset.recipeId === initialRecipe))?.id || '');
  const [comparison, setComparison] = useState(null);
  const [filter, setFilter] = useState('all');
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [monitorName, setMonitorName] = useState('');
  const [recipeId, setRecipeId] = useState(initialRecipe);
  const [cadence, setCadence] = useState('weekly');
  const [monitorSaved, setMonitorSaved] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || Boolean(working);
  const current = datasets.find((dataset) => dataset.id === currentId);
  const baseline = datasets.find((dataset) => dataset.id === baselineId);
  const changes = comparison?.changes || [];
  const shown = filter === 'all' ? changes : changes.filter((change) => change.status === filter);
  function setChangeFilter(value) { setFilter(value); setVisibleLimit(50); }
  async function openSource(event, url) {
    if (!window.apifyStudio?.openSourceUrl) return;
    event.preventDefault();
    try { await window.apifyStudio.openSourceUrl(url); } catch (failure) { setError(failure?.message || 'The source link could not be opened.'); }
  }
  function updateCurrent(value) { setVisibleLimit(50); setCurrentId(value); setComparison(null); setError(''); setMonitorSaved(false); setRecipeId(datasets.find((dataset) => dataset.id === value)?.recipeId || ''); }
  async function run(action, label) {
    if (locked || inFlight.current) return;
    inFlight.current = true; setWorking(label); setError('');
    try { await action(); } catch (failure) { setError(failure?.message || 'This step could not be completed. Please try again.'); }
    finally { inFlight.current = false; setWorking(''); }
  }
  function compare() {
    if (!current || !baseline || currentId === baselineId) return;
    run(async () => {
      const result = await onCompare({ baselineId, currentId });
      if (!result?.summary || !Array.isArray(result.changes)) throw new Error('The comparison was not returned. Please try again.');
      setComparison(result); setChangeFilter('all');
    }, 'compare');
  }
  function saveMonitor() {
    if (!current || !recipeId || !onSaveMonitor) return;
    run(async () => {
      const result = await onSaveMonitor({ name: monitorName.trim() || `${recipes.find((recipe) => recipe.id === recipeId)?.name || 'Collection'} check-in`, recipeId, baselineDatasetId: currentId, cadence });
      if (!result) throw new Error('The check-in could not be saved. Please try again.');
      setMonitorSaved(true);
    }, 'monitor');
  }
  return <section className="snapshot-workspace" aria-labelledby="compare-title"><header className="snapshot-heading"><span>SEE WHAT ACTUALLY CHANGED</span><h2 id="compare-title">Compare the evidence over time.</h2><p>Put two collected snapshots side by side. Review source text changes before deciding what matters.</p></header>
    {!datasets.length ? <div className="snapshot-empty"><History size={30} aria-hidden="true" /><h3>Your first collection is the starting point.</h3><p>Collect or import research, then collect it again later to measure changes. A first snapshot establishes a baseline.</p><button type="button" onClick={() => onNavigate?.('search')}>Collect research<ArrowRight size={15} aria-hidden="true" /></button></div> : <>
      <section className="snapshot-picker"><div className="snapshot-picker-title"><GitCompareArrows size={20} aria-hidden="true" /><div><h3>Choose your snapshots</h3><p>Use the same source and collection scope for a meaningful comparison.</p></div></div><div className="snapshot-selectors">
        <label>Earlier baseline<select aria-label="Earlier baseline" value={baselineId} disabled={locked} onChange={(event) => { setBaselineId(event.target.value); setVisibleLimit(50); setComparison(null); setError(''); }}><option value="">Choose a baseline</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{datasetLabel(dataset)}</option>)}</select><small>{baseline ? dateLabel(baseline.createdAt) : 'Your earlier collected evidence'}</small></label><span className="snapshot-direction"><ArrowRight size={20} aria-hidden="true" /></span>
        <label>Current snapshot<select aria-label="Current snapshot" value={currentId} disabled={locked} onChange={(event) => updateCurrent(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{datasetLabel(dataset)}</option>)}</select><small>{current ? dateLabel(current.createdAt) : 'Your latest collected evidence'}</small></label>
      </div>{datasets.length < 2 && <p className="snapshot-baseline-note"><History size={15} aria-hidden="true" />This collection establishes a baseline. Collect the same sources again before measuring change.</p>}{baselineId && baselineId === currentId && <p className="snapshot-warning" role="alert">Choose two different snapshots.</p>}<div className="snapshot-picker-footer"><span>Local text comparison · no AI or collection charges</span><button type="button" disabled={locked || !baseline || !current || baselineId === currentId || !onCompare} onClick={compare}>{working === 'compare' ? 'Comparing…' : 'Compare snapshots'}<GitCompareArrows size={16} aria-hidden="true" /></button></div></section>
      {error && <p className="snapshot-error" role="alert">{error}</p>}
      {comparison && <section className="snapshot-results" aria-labelledby="comparison-results-title"><div className="snapshot-results-heading"><div><span>COMPARISON RESULT</span><h3 id="comparison-results-title">{comparison.summary.baselineEstablished ? 'Baseline established' : comparison.scopeStatus === 'incompatible' ? 'Choose matching sources' : `${comparison.summary.changed || 0} source${comparison.summary.changed === 1 ? '' : 's'} changed`}</h3></div><p>URL matches ignore fragments and known tracking parameters.<br />Whitespace-only differences do not count as changes.</p></div>
        {comparison.warnings?.length > 0 && <ul className="snapshot-warnings">{comparison.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        {comparison.comparisonDataset?.id && comparison.comparisonDataset.itemCount > 0 && !comparison.summary.baselineEstablished && comparison.scopeStatus !== 'incompatible' && <div className="snapshot-brief-action"><div><strong>Turn the differences into a weekly brief.</strong><p>The report uses these before-and-after excerpts, capture dates, and scope warnings.</p></div><button type="button" disabled={locked} onClick={() => onNavigate?.('reports', { datasetId: comparison.comparisonDataset.id, reportPresetId: 'weekly-competitor-changes' })}>Draft change brief<ArrowRight size={15} aria-hidden="true" /></button></div>}{!comparison.summary.baselineEstablished && comparison.scopeStatus !== 'incompatible' && <><div className="snapshot-counts">{['changed', 'new', 'unavailable', 'unchanged'].map((status) => <button type="button" key={status} className={`snapshot-count ${status} ${filter === status ? 'selected' : ''}`} onClick={() => setChangeFilter(filter === status ? 'all' : status)} aria-pressed={filter === status} aria-label={`${comparison.summary[status] || 0} ${labels[status]}`}><strong>{comparison.summary[status] || 0}</strong><span>{labels[status]}</span></button>)}</div><div className="snapshot-list-heading"><h4>{filter === 'all' ? 'Source-by-source evidence' : labels[filter]}</h4>{filter !== 'all' && <button type="button" className="ghost" onClick={() => setChangeFilter('all')}>Show all sources</button>}</div>{shown.length ? <div className="snapshot-change-list">{shown.slice(0, visibleLimit).map((change) => <article className={`snapshot-change ${change.status}`} key={change.url}><header><span className={`snapshot-status ${change.status}`}>{labels[change.status]}</span><a className="snapshot-url" href={change.url} target="_blank" rel="noopener noreferrer" onClick={(event) => openSource(event, change.url)}>{change.url}</a></header>{change.reason && <p className="snapshot-change-reason">{change.reason}</p>}<div className="snapshot-excerpts"><section><div><strong>Before</strong><small>{change.beforeExcerpt ? dateLabel(change.beforeCollectedAt) : 'No matching captured text'}</small></div><p>{change.beforeExcerpt || 'No text available in this snapshot.'}</p></section><section><div><strong>After</strong><small>{change.afterExcerpt ? dateLabel(change.afterCollectedAt) : 'No matching captured text'}</small></div><p>{change.afterExcerpt || 'No text available in this snapshot.'}</p></section></div></article>)}{shown.length > visibleLimit && <button type="button" className="ghost snapshot-show-more" onClick={() => setVisibleLimit((limit) => limit + 50)}>Show next {Math.min(50, shown.length - visibleLimit)} sources ({shown.length - visibleLimit} remaining)</button>}</div> : <p className="snapshot-no-results">No sources in this category.</p>}</>}
      </section>}
      {onSaveMonitor && recipes.length > 0 && <details className="snapshot-monitor"><summary><CalendarClock size={17} aria-hidden="true" /><span>Make this a regular check-in<small>A local due reminder. You decide when to collect again.</small></span></summary><div className="snapshot-monitor-body"><p>Save the current snapshot as a baseline and choose a scraper to revisit. This does not schedule paid runs or send notifications.</p><div className="snapshot-monitor-fields"><label>Check-in name<input value={monitorName} disabled={locked} maxLength={160} placeholder="e.g. Weekly competitor review" onChange={(event) => { setMonitorName(event.target.value); setMonitorSaved(false); }} /></label><label>Scraper<select aria-label="Scraper" value={recipeId} disabled={locked} onChange={(event) => { setRecipeId(event.target.value); setMonitorSaved(false); }}><option value="">Choose a scraper</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label><label>Review cadence<select aria-label="Review cadence" value={cadence} disabled={locked} onChange={(event) => { setCadence(event.target.value); setMonitorSaved(false); }}><option value="weekly">Weekly</option><option value="daily">Daily</option></select></label></div>{current?.recipeId && recipeId && current.recipeId !== recipeId && <p className="snapshot-warning">This recipe differs from the current snapshot's recipe. Confirm it collects the same sources.</p>}<div className="snapshot-monitor-footer"><span>Baseline: {current?.name || 'Choose a current snapshot'}</span><button type="button" disabled={locked || !recipeId || !current} onClick={saveMonitor}>{working === 'monitor' ? 'Saving…' : 'Save check-in'}{monitorSaved ? <CheckCircle2 size={15} aria-hidden="true" /> : <CalendarClock size={15} aria-hidden="true" />}</button></div>{monitorSaved && <p className="snapshot-monitor-saved" role="status">Check-in saved. Open this workspace when you are ready to collect and compare again.</p>}</div></details>}
      {(state.monitors || []).length > 0 && <section className="snapshot-saved-monitors"><h3>Saved check-ins</h3>{state.monitors.map((monitor) => <article key={monitor.id}><CalendarClock size={16} aria-hidden="true" /><div><strong>{monitor.name}</strong><span>{monitor.cadence === 'daily' ? 'Daily' : 'Weekly'} · manual collection{monitor.nextCheckAt || monitor.nextDueAt || monitor.dueAt ? ` · Next review ${dateLabel(monitor.nextCheckAt || monitor.nextDueAt || monitor.dueAt)}` : ''}</span></div>{onNavigate && monitor.recipeId && <button type="button" className="ghost" onClick={() => onNavigate('automation', { recipeId: monitor.recipeId })}><RefreshCw size={13} aria-hidden="true" />Open scrapers</button>}</article>)}</section>}
    </>}
  </section>;
}
