import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AtSign, Briefcase, Check, ChevronDown, Code2, Copy, Database, Globe, Info, Loader2, MessageCircle, Pencil, Play, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { RECIPE_TEMPLATES } from '../../shared/recipe-templates.js';
import { Badge, Button, number } from './ui.jsx';

// “3 hours ago” reads faster than a timestamp on a card you scan.
function timeAgo(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const latestRunFor = (runs, recipeId) => runs.filter((run) => run.recipeId === recipeId).reduce((latest, run) => !latest || new Date(run.startedAt || run.createdAt || 0) > new Date(latest.startedAt || latest.createdAt || 0) ? run : latest, null);
import './recipe-flow.css';

const SOURCES = [
  { id: 'web', label: 'Websites', detail: 'Pages, products, and more', icon: Globe },
  { id: 'reddit', label: 'Reddit', detail: 'Communities and conversations', icon: MessageCircle },
  { id: 'linkedin', label: 'LinkedIn', detail: 'Companies and professional posts', icon: Briefcase },
  { id: 'x', label: 'X / Twitter', detail: 'Posts and public discussions', icon: AtSign },
  { id: 'other', label: 'Other source', detail: 'Any Apify Actor or saved task', icon: Database },
];

function makeDraft(recipe, templateId) {
  const template = RECIPE_TEMPLATES.find((item) => item.id === templateId);
  return {
    name: recipe?.name || template?.name || '',
    platform: recipe?.platform || template?.platform || 'web',
    actorId: recipe?.actorId || '',
    taskId: recipe?.taskId || '',
    proxyNote: recipe?.proxyNote || '',
    inputJson: JSON.stringify(recipe?.input || {}, null, 2),
    mapperJson: JSON.stringify(recipe?.mapper || {}, null, 2),
  };
}

function jsonError(value, label) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return `${label} must be a JSON object, starting with { and ending with }.`;
    return '';
  } catch {
    return `${label} is not valid JSON. Check that keys use double quotes and that commas and brackets are in the right places.`;
  }
}

function SourceIcon({ platform, size = 20 }) {
  const Icon = (SOURCES.find((source) => source.id === platform) || SOURCES[4]).icon;
  return <Icon size={size} aria-hidden="true" />;
}

function RecipeForm({ recipe, initialTemplateId, latestVersion = 0, onSave, onCancel, onDiscoverApifyResource, onTestRecipe, onSaveRecipeVersion, busy }) {
  const [draft, setDraft] = useState(() => makeDraft(recipe, initialTemplateId));
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(recipe?.taskId ? 'task' : 'actor');
  const [selectedSource, setSelectedSource] = useState(() => {
    const platform = recipe?.platform || initialTemplateId || 'web';
    return SOURCES.some((source) => source.id === platform) ? platform : 'other';
  });
  const [discovery, setDiscovery] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [toolAction, setToolAction] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const headingRef = useRef(null);
  const versionRef = useRef(Number(recipe?.version || 0));
  const formId = useId();
  const working = busy || saving || Boolean(toolAction);
  const sourceError = !draft.name.trim() ? 'Give your scraper a name so you can find it later.' : !draft.platform.trim() ? 'Enter the name of your source.' : '';
  const resourceError = !draft[kind === 'task' ? 'taskId' : 'actorId'].trim() ? `Add the ${kind === 'task' ? 'saved task' : 'Actor'} ID from your Apify account.` : '';
  const inputError = jsonError(draft.inputJson, 'Actor input');
  const mapperError = jsonError(draft.mapperJson, 'Output mapping');
  const configurationError = resourceError || inputError || mapperError;
  const stepError = step === 0 ? sourceError : step === 1 ? configurationError : sourceError || configurationError;
  const template = RECIPE_TEMPLATES.find((item) => item.id === draft.platform);

  function set(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError('');
    setAttempted(false);
    if (key === 'actorId' || key === 'taskId') setDiscovery(null);
  }

  function payload() {
    return { ...recipe, ...draft, actorId: kind === 'actor' ? draft.actorId : '', taskId: kind === 'task' ? draft.taskId : '' };
  }

  function changeStep(next) {
    setStep(next);
    setAttempted(false);
    setSaveError('');
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function runTool(name, action) {
    setToolAction(name);
    setFeedback(null);
    try {
      const result = await action();
      if (!result) setFeedback({ error: true, message: 'This action could not be completed. Check the message above and try again.' });
      return result;
    } catch (error) {
      setFeedback({ error: true, message: error.message || String(error) });
      return null;
    } finally {
      setToolAction('');
    }
  }

  async function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (stepError || working) return;
    if (step < 2) return changeStep(step + 1);
    setSaving(true);
    setSaveError('');
    try {
      const result = await onSave(payload());
      if (!result) setSaveError('Your scraper could not be saved. Your changes are still here; check the message above and try again.');
    } catch (error) {
      setSaveError(error.message || 'Your scraper could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scraper-editor">
      <Button type="button" className="ghost scraper-back" disabled={working} onClick={onCancel}><ArrowLeft size={16} />All scrapers</Button>
      <div className="scraper-editor-heading"><div><span className="scraper-eyebrow">{recipe?.id ? 'MAKE IT YOURS' : 'A FEW STEPS TO YOUR NEXT DISCOVERY'}</span><h2>{recipe?.id ? 'Edit scraper' : 'Create a scraper'}</h2><p>Choose a source, connect your Apify scraper, and save it for next time.</p></div><span className="scraper-step-count">Step {step + 1} of 3</span></div>
      <ol className="scraper-steps" aria-label="Scraper setup progress">
        {['Choose source', 'Configure scraper', 'Review & save'].map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}
      </ol>
      <form className="scraper-form" noValidate onSubmit={submit}>
        <div className="scraper-form-body">
          {step === 0 && <>
            <div className="scraper-section-heading"><h3 ref={headingRef} tabIndex={-1}>Where do you want to collect data?</h3><p>Pick a source to organize your scraper. You’ll connect an Actor or saved task next.</p></div>
            <div className="scraper-source-grid" role="group" aria-label="Data source">
              {SOURCES.map((source) => <button key={source.id} type="button" className={`scraper-source-option ${selectedSource === source.id ? 'selected' : ''}`} aria-pressed={selectedSource === source.id} aria-label={source.label} aria-describedby={`${formId}-source-${source.id}`} onClick={() => {
                setSelectedSource(source.id);
                const nextTemplate = RECIPE_TEMPLATES.find((item) => item.id === source.id);
                setDraft((current) => ({ ...current, platform: source.id === 'other' ? '' : source.id, name: current.name || nextTemplate?.name || '' }));
                setAttempted(false);
              }}><span className="scraper-source-symbol"><source.icon size={22} /></span><strong>{source.label}</strong><small id={`${formId}-source-${source.id}`}>{source.detail}</small>{selectedSource === source.id && <Check className="scraper-selected-check" size={16} />}</button>)}
            </div>
            <div className="scraper-fields">
              <label htmlFor={`${formId}-name`}>Scraper name<input autoFocus id={`${formId}-name`} aria-label="Scraper name" value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Weekly customer conversations" autoComplete="off" aria-invalid={attempted && !draft.name.trim()} aria-describedby={attempted && sourceError ? `${formId}-error` : undefined} /><span className="scraper-field-hint">A clear name makes it easy to find and run again.</span></label>
              {selectedSource === 'other' && <label htmlFor={`${formId}-platform`}>Source name<input id={`${formId}-platform`} value={draft.platform} onChange={(event) => set('platform', event.target.value)} placeholder="e.g. YouTube, Google Maps, or a website" /></label>}
            </div>
          </>}
          {step === 1 && <>
            <div className="scraper-section-heading"><h3 ref={headingRef} tabIndex={-1}>Connect your Apify scraper</h3><p>Apify Actors collect data. Saved tasks are Actors you’ve already configured in Apify.</p></div>
            <div className="scraper-kind-switch" role="group" aria-label="Apify resource type"><button type="button" className={kind === 'actor' ? 'selected' : ''} aria-pressed={kind === 'actor'} onClick={() => { setKind('actor'); setDiscovery(null); setAttempted(false); }}>Use an Actor</button><button type="button" className={kind === 'task' ? 'selected' : ''} aria-pressed={kind === 'task'} onClick={() => { setKind('task'); setDiscovery(null); setAttempted(false); }}>Use a saved task</button></div>
            <label htmlFor={`${formId}-resource`}>{kind === 'actor' ? 'Actor ID' : 'Saved task ID'}<input autoFocus id={`${formId}-resource`} aria-label={kind === 'actor' ? 'Actor ID' : 'Saved task ID'} value={draft[kind === 'task' ? 'taskId' : 'actorId']} onChange={(event) => set(kind === 'task' ? 'taskId' : 'actorId', event.target.value)} placeholder={kind === 'actor' ? 'e.g. apify/website-content-crawler' : 'Paste your saved task ID'} spellCheck={false} autoCapitalize="none" aria-invalid={attempted && Boolean(resourceError)} aria-describedby={`${formId}-resource-help`} /><span id={`${formId}-resource-help`} className="scraper-field-hint">Find this in Apify Console → {kind === 'actor' ? 'Actors → your Actor' : 'Saved tasks → your task'}. An ID identifies the scraper to run.</span></label>
            <div className="scraper-input-heading"><label htmlFor={`${formId}-input`}>{kind === 'task' ? 'Task input overrides' : 'Actor input'} <span className="scraper-optional">JSON</span></label></div>
            <p className="scraper-field-hint">{kind === 'task' ? 'Use {} to keep the saved task’s configuration, or paste JSON to override specific settings.' : 'Paste the Input JSON from your Actor in Apify Console. Each Actor has its own fields for URLs, searches, and limits.'}</p>
            <textarea className="scraper-code-input" id={`${formId}-input`} value={draft.inputJson} onChange={(event) => set('inputJson', event.target.value)} rows={8} spellCheck={false} aria-invalid={Boolean(inputError)} aria-describedby={inputError ? `${formId}-input-error` : undefined} />
            {inputError && <p id={`${formId}-input-error`} className="scraper-field-error" role="alert">{inputError}</p>}
            {draft.inputJson.includes('[redacted]') && <div className="scraper-info"><Info size={17} /><p>Private values are hidden in this editor. Keep <code>[redacted]</code> placeholders unchanged to preserve stored credentials.</p></div>}
            <details className="scraper-advanced">
              <summary><Settings2 size={17} /><span>Advanced settings & tools</span><ChevronDown size={17} /></summary>
              <div className="scraper-advanced-body">
                <div><h4>Inspect the Apify configuration</h4><p>Look up available inputs before making changes. Discovered examples may need adjustment for your Actor.</p><Button type="button" className="ghost" disabled={working || Boolean(resourceError)} onClick={() => runTool('discover', async () => { const result = await onDiscoverApifyResource({ actorId: kind === 'actor' ? draft.actorId : '', taskId: kind === 'task' ? draft.taskId : '' }); setDiscovery(result); return result; })}>{toolAction === 'discover' ? <Loader2 className="scraper-spin" size={15} /> : <Search size={15} />}Discover schema</Button></div>
                {discovery && <div className="scraper-tool-result"><strong>{discovery.title || 'Discovered configuration'}</strong><p>{discovery.warnings?.filter(Boolean).join(' ') || 'Review the discovered input before applying it.'}</p><pre>{JSON.stringify({ input: discovery.inputTemplate || {}, mapping: discovery.mapperTemplate || {} }, null, 2)}</pre><Button type="button" className="ghost" disabled={working} onClick={() => { set('inputJson', JSON.stringify(discovery.inputTemplate || {}, null, 2)); set('mapperJson', JSON.stringify(discovery.mapperTemplate || {}, null, 2)); setFeedback({ message: 'Input and mapping replaced with the discovered example. Review the fields before saving.' }); }}>Replace input & mapping</Button></div>}
                {template && <div><h4>Example {template.label} input</h4><p>This is a starting example. It is not linked to an Actor and may use different fields from yours. Loading it replaces your input and mapping.</p><Button type="button" className="ghost" disabled={working} onClick={() => { setDraft((current) => ({ ...current, inputJson: JSON.stringify(template.input, null, 2), mapperJson: JSON.stringify(template.mapper, null, 2), proxyNote: current.proxyNote || template.proxyNote })); setFeedback({ message: 'Example loaded. Check every field against your Actor’s input requirements.' }); }}><Code2 size={15} />Load example input</Button></div>}
                <label htmlFor={`${formId}-mapper`}>Output mapping <span className="scraper-field-hint">Optional. Map Actor output fields to text, author, URL, and timestamp. Use <code>{'{}'}</code> for automatic normalization.</span><textarea className="scraper-code-input" id={`${formId}-mapper`} value={draft.mapperJson} onChange={(event) => set('mapperJson', event.target.value)} rows={5} spellCheck={false} aria-invalid={Boolean(mapperError)} aria-describedby={mapperError ? `${formId}-mapper-error` : undefined} /></label>
                {mapperError && <p id={`${formId}-mapper-error`} className="scraper-field-error" role="alert">{mapperError}</p>}
                <label htmlFor={`${formId}-note`}>Notes <span className="scraper-optional">Optional</span><input id={`${formId}-note`} value={draft.proxyNote} onChange={(event) => set('proxyNote', event.target.value)} placeholder="Proxy requirements, costs, or a reminder for next time" /></label>
                <div><h4>Test a small sample</h4><p>This starts a real Apify run and may incur charges. Up to 10 rows are downloaded; this does not cap how much the Actor collects. Actor input and any saved run budget control collection.</p><Button type="button" className="ghost" disabled={working || Boolean(sourceError || configurationError)} onClick={() => runTool('test', async () => { const result = await onTestRecipe(payload()); setTestResult(result); return result; })}>{toolAction === 'test' ? <Loader2 className="scraper-spin" size={15} /> : <Play size={15} />}Test sample</Button></div>
                {testResult && <div className="scraper-tool-result"><Badge tone={testResult.error ? 'warning' : 'ready'}>{testResult.error ? 'Sample failed' : 'Sample complete'}</Badge><strong>{testResult.error || `${testResult.normalizedSample?.length || 0} sample rows returned`}</strong>{testResult.profile?.mapperWarnings?.length > 0 && <p>{testResult.profile.mapperWarnings.join(' ')}</p>}<details><summary>View sample data</summary><pre>{JSON.stringify(testResult.normalizedSample || testResult.rawSample || [], null, 2)}</pre></details></div>}
                <div><h4>Save a version</h4><p>{recipe?.id ? 'Keep a checkpoint of your current input and mapping.' : 'Save this scraper first, then reopen it to create version checkpoints.'}</p><Button type="button" className="ghost" disabled={working || !recipe?.id || Boolean(sourceError || configurationError)} onClick={() => runTool('version', async () => { const nextVersion = Math.max(versionRef.current, latestVersion) + 1; const result = await onSaveRecipeVersion({ recipeId: recipe.id, version: { version: nextVersion, name: draft.name, input: JSON.parse(draft.inputJson || '{}'), mapper: JSON.parse(draft.mapperJson || '{}'), notes: 'Saved from scraper setup' } }); if (result) { versionRef.current = nextVersion; setFeedback({ message: `Version ${nextVersion} checkpoint saved.` }); } return result; })}>Save version</Button></div>
              </div>
            </details>
            {feedback && <div className={feedback.error ? 'scraper-field-error' : 'scraper-feedback'} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</div>}
          </>}
          {step === 2 && <>
            <div className="scraper-section-heading"><div className="scraper-review-icon"><Check size={25} /></div><h3 ref={headingRef} tabIndex={-1}>Your scraper is ready to save</h3><p>Keep this configuration handy and run it whenever you need fresh data.</p></div>
            <div className="scraper-review-card"><span className="scraper-source-symbol"><SourceIcon platform={draft.platform} size={24} /></span><div><h4>{draft.name}</h4><span>{SOURCES.find((source) => source.id === draft.platform)?.label || draft.platform}</span></div></div>
            <dl className="scraper-review-details"><div><dt>{kind === 'actor' ? 'Apify Actor' : 'Saved task'}</dt><dd>{kind === 'actor' ? draft.actorId : draft.taskId}</dd></div><div><dt>Input</dt><dd>{Object.keys(JSON.parse(draft.inputJson || '{}')).length} configured fields</dd></div><div><dt>Output mapping</dt><dd>{Object.keys(JSON.parse(draft.mapperJson || '{}')).length ? 'Custom mapping' : 'Automatic normalization'}</dd></div>{draft.proxyNote && <div><dt>Notes</dt><dd>{draft.proxyNote}</dd></div>}</dl>
            {recipe?.runOptions && <div className="scraper-info"><Info size={18} /><p>Apify run budget: ${recipe.runOptions.maxTotalChargeUsd.toFixed(2)} · Timeout: {recipe.runOptions.timeoutSecs / 60} minutes. AI analysis is billed separately.</p></div>}
            <details className="scraper-review-json"><summary>Review input JSON<ChevronDown size={16} /></summary><pre>{draft.inputJson}</pre></details>
            <div className="scraper-info"><Info size={18} /><p>Saving won’t start a run. When you run your scraper, Apify usage is billed to your Apify account.</p></div>
          </>}
          {attempted && stepError && <p id={`${formId}-error`} className="scraper-field-error" role="alert">{stepError}</p>}
          {saveError && <p className="scraper-field-error" role="alert">{saveError}</p>}
        </div>
        <div className="scraper-form-footer"><Button type="button" className="ghost" disabled={working} onClick={() => step ? changeStep(step - 1) : onCancel()}>{step ? <ArrowLeft size={16} /> : null}{step ? 'Back' : 'Cancel'}</Button><span>{step === 2 ? 'Run it when you’re ready.' : 'Your configuration stays on this Mac.'}</span><Button className="scraper-primary" type="submit" disabled={working}>{saving ? <Loader2 size={16} className="scraper-spin" /> : null}{saving ? 'Saving…' : step === 2 ? 'Save scraper' : 'Continue'}{step < 2 && <ArrowRight size={16} />}</Button></div>
      </form>
    </div>
  );
}

export function AutomationView({ state, busy, onSaveRecipe, onRunRecipe, onDeleteRecipe, onDiscoverApifyResource, onTestRecipe, onSaveRecipeVersion, initialTemplateId, creationKey, onOpenDataset }) {
  const [editing, setEditing] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [templateId, setTemplateId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [listError, setListError] = useState('');
  const lastCreationKey = useRef(null);
  const recipes = state.recipes || [];
  const allRuns = state.runs || [];
  const datasetIds = new Set((state.datasets || []).map((dataset) => dataset.id));
  const filtered = recipes.filter((recipe) => `${recipe.name} ${recipe.platform} ${recipe.actorId || recipe.taskId}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort(sort === 'name' ? (a, b) => String(a.name).localeCompare(String(b.name)) : (a, b) => String(latestRunFor(allRuns, b.id)?.startedAt || '').localeCompare(String(latestRunFor(allRuns, a.id)?.startedAt || '')) || String(a.name).localeCompare(String(b.name)));

  function startNew(nextTemplateId) {
    setEditing({});
    setTemplateId(nextTemplateId || null);
    setEditorKey((current) => current + 1);
    setPendingDelete(null);
    setListError('');
  }

  useEffect(() => {
    if (creationKey != null && creationKey !== lastCreationKey.current) {
      lastCreationKey.current = creationKey;
      startNew(initialTemplateId);
    }
  }, [creationKey, initialTemplateId]);

  if (editing) return <section className="scraper-view"><RecipeForm key={editorKey} busy={busy} recipe={editing} latestVersion={Math.max(0, ...(state.v5?.recipeVersions?.[editing.id] || []).map((version) => Number(version.version) || 0))} initialTemplateId={templateId} onCancel={() => setEditing(null)} onDiscoverApifyResource={onDiscoverApifyResource} onTestRecipe={onTestRecipe} onSaveRecipeVersion={onSaveRecipeVersion} onSave={async (nextRecipe) => { const result = await onSaveRecipe(nextRecipe); if (result) setEditing(null); return result; }} /></section>;

  return <section className="scraper-view">
    <div className="scraper-library-heading"><div><h2>Your scrapers <span>{recipes.length}</span></h2><p>A little setup now. Fresh data whenever you need it.</p></div><Button className="scraper-primary" disabled={busy} onClick={() => startNew()}><Plus size={17} />New scraper</Button></div>
    {recipes.length > 0 && <div className="scraper-toolbar"><label className="scraper-search"><Search size={18} /><span className="sr-only">Search scrapers</span><input type="search" placeholder="Find a scraper…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>{recipes.length > 1 && <select aria-label="Sort scrapers" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently run</option><option value="name">Name A–Z</option></select>}</div>}
    {listError && <p className="scraper-field-error" role="alert">{listError}</p>}
    {pendingDelete && <div className="scraper-delete-confirm" role="alert"><div><strong>Delete “{pendingDelete.name}”?</strong><p>Your existing runs and datasets will stay available.</p></div><div className="button-row"><Button className="ghost" disabled={busy} onClick={() => setPendingDelete(null)}>Keep scraper</Button><Button className="danger" disabled={busy} onClick={async () => { try { const result = await onDeleteRecipe(pendingDelete.id); if (result) setPendingDelete(null); } catch (error) { setListError(error.message || 'The scraper could not be deleted.'); } }}>Delete scraper</Button></div></div>}
    {!recipes.length ? <div className="scraper-empty"><div className="scraper-empty-art"><span><Database size={28} /></span><span><Globe size={24} /></span><span><MessageCircle size={20} /></span></div><span className="scraper-eyebrow">MAKE THE WEB WORK FOR YOU</span><h3>Your first scraper starts here</h3><p>Connect an Apify Actor or saved task to turn websites and conversations into useful data.</p><Button className="scraper-primary" disabled={busy} onClick={() => startNew()}><Plus size={17} />Create your first scraper</Button><small>Already have an Apify saved task? You can use it here.</small></div> : filtered.length ? <div className="scraper-library-grid">{filtered.map((recipe) => {
      const runCount = allRuns.filter((run) => run.recipeId === recipe.id).length;
      const latestRun = latestRunFor(allRuns, recipe.id);
      const latestDataset = latestRun?.datasetId && datasetIds.has(latestRun.datasetId) ? latestRun.datasetId : '';
      const runSummary = !latestRun ? 'No runs yet' : latestRun.status === 'running' ? 'Running now' : latestRun.status === 'failed' ? `Failed ${timeAgo(latestRun.startedAt)}` : `Ran ${timeAgo(latestRun.startedAt)}${latestRun.itemCount != null ? ` · ${number(latestRun.itemCount)} rows` : ''}`;
      return <article className="scraper-library-card" key={recipe.id}><div className="scraper-card-top"><span className="scraper-source-symbol"><SourceIcon platform={recipe.platform} /></span><Badge>{SOURCES.find((source) => source.id === recipe.platform)?.label || recipe.platform}</Badge><span className="scraper-card-tools"><Button type="button" className="ghost scraper-icon-button" disabled={busy} aria-label={`Duplicate ${recipe.name}`} title="Duplicate" onClick={() => { setEditing({ ...recipe, id: undefined, name: `${recipe.name} (copy)` }); setTemplateId(null); setEditorKey((current) => current + 1); }}><Copy size={15} /></Button><Button type="button" className="ghost scraper-icon-button" disabled={busy} aria-label={`Delete ${recipe.name}`} title="Delete" onClick={() => setPendingDelete(recipe)}><Trash2 size={16} /></Button></span></div><h3>{recipe.name}</h3><p className="scraper-resource-id" title={recipe.actorId || recipe.taskId}>{recipe.actorId || recipe.taskId}</p><p className="scraper-card-note">{recipe.proxyNote || (recipe.taskId ? 'Connected to your saved Apify task.' : 'Ready with your saved Actor configuration.')}</p>{recipe.runOptions && <p className="scraper-field-hint">Apify budget ${Number(recipe.runOptions.maxTotalChargeUsd).toFixed(2)} / run · {recipe.runOptions.timeoutSecs / 60} min limit</p>}<div className="scraper-card-footer"><span className={`scraper-run-state ${latestRun?.status || ''}`} title={latestRun?.error || ''}><i />{runSummary}{runCount > 1 && <small> · {number(runCount)} runs</small>}</span><div>{latestDataset && onOpenDataset && <Button className="ghost" aria-label={`Open data from ${recipe.name}`} onClick={() => onOpenDataset(latestDataset)}><Database size={14} />Data</Button>}<Button className="ghost" disabled={busy} aria-label={`Edit ${recipe.name}`} onClick={() => { setEditing(recipe); setTemplateId(null); setEditorKey((current) => current + 1); }}><Pencil size={14} />Edit</Button><Button className="scraper-primary" disabled={busy} aria-label={`Run ${recipe.name}`} onClick={() => onRunRecipe(recipe.id)}><Play size={14} />Run</Button></div></div></article>;
    })}</div> : <div className="scraper-no-results"><Search size={24} /><h3>No scrapers match “{query}”</h3><p>Try another name, source, or Actor ID.</p><Button className="ghost" onClick={() => setQuery('')}>Clear search</Button></div>}
    {recipes.length > 0 && <div className="scraper-library-tip"><Info size={16} /><p>Scrapers use your connected Apify account. Set up a saved task in Apify for the quickest way to get started.</p></div>}
  </section>;
}
