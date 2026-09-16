import { useEffect, useState } from 'react';
import { RECIPE_TEMPLATES } from '../../shared/recipe-templates.js';
import { Badge, Button, Empty } from './ui.jsx';

function recipeDraftError(draft) {
  if (!draft.name.trim()) return 'Name is required.';
  if (!draft.platform.trim()) return 'Platform is required.';
  if (!draft.actorId.trim() && !draft.taskId.trim()) return 'Actor ID or task ID is required.';
  if (draft.actorId.trim() && draft.taskId.trim()) return 'Use either Actor ID or task ID, not both.';
  try {
    for (const value of [draft.inputJson, draft.mapperJson]) {
      const parsed = JSON.parse(value || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'JSON fields must be objects.';
    }
  } catch (error) {
    return error.message || String(error);
  }
  return '';
}

function recipeIdFromDraft(draft, currentRecipe) {
  return currentRecipe?.id || `recipe-${String(draft.name || 'draft').toLowerCase().replace(/[^a-z0-9._~@-]+/g, '-')}`;
}

function RecipeForm({ recipe: currentRecipe, onSave, onCancel, onDiscoverApifyResource, onTestRecipe, onSaveRecipeVersion, busy }) {
  const [draft, setDraft] = useState(() => ({
    name: currentRecipe?.name || '',
    platform: currentRecipe?.platform || 'reddit',
    actorId: currentRecipe?.actorId || '',
    taskId: currentRecipe?.taskId || '',
    proxyNote: currentRecipe?.proxyNote || '',
    inputJson: JSON.stringify(currentRecipe?.input || { startUrls: [] }, null, 2),
    mapperJson: JSON.stringify(currentRecipe?.mapper || {}, null, 2),
  }));
  const [discovery, setDiscovery] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [v5Busy, setV5Busy] = useState(false);

  useEffect(() => {
    setDraft({
      name: currentRecipe?.name || '',
      platform: currentRecipe?.platform || 'reddit',
      actorId: currentRecipe?.actorId || '',
      taskId: currentRecipe?.taskId || '',
      proxyNote: currentRecipe?.proxyNote || '',
      inputJson: JSON.stringify(currentRecipe?.input || { startUrls: [] }, null, 2),
      mapperJson: JSON.stringify(currentRecipe?.mapper || {}, null, 2),
    });
  }, [currentRecipe?.id]);

  function set(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(template) {
    setDraft((current) => ({
      ...current,
      name: current.name || template.name,
      platform: template.platform,
      proxyNote: current.proxyNote || template.proxyNote,
      inputJson: JSON.stringify(template.input, null, 2),
      mapperJson: JSON.stringify(template.mapper, null, 2),
    }));
  }

  const formError = recipeDraftError(draft);

  function recipePayload() {
    return { ...currentRecipe, ...draft };
  }

  async function runV5Action(action) {
    setV5Busy(true);
    setTestResult(null);
    try {
      return await action();
    } catch (error) {
      setTestResult({ error: error.message || String(error) });
      return null;
    } finally {
      setV5Busy(false);
    }
  }

  return (
    <form className="recipe-form" onSubmit={(event) => {
      event.preventDefault();
      if (formError) return;
      onSave({ ...currentRecipe, ...draft });
    }}>
      <div className="template-strip">
        <span>Input templates</span>
        <div className="button-row">
          {RECIPE_TEMPLATES.map((template) => (
            <Button type="button" className="ghost" key={template.id} onClick={() => applyTemplate(template)}>
              {template.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="field-grid two">
        <label htmlFor="recipe-name">Name<input id="recipe-name" value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder="Subreddit pulse" required /></label>
        <label htmlFor="recipe-platform">Platform<input id="recipe-platform" value={draft.platform} onChange={(event) => set('platform', event.target.value)} placeholder="reddit, linkedin, x" required /></label>
      </div>
      <div className="field-grid two">
        <label htmlFor="recipe-actor">Actor ID<input id="recipe-actor" value={draft.actorId} onChange={(event) => set('actorId', event.target.value)} placeholder="apify/web-scraper" /></label>
        <label htmlFor="recipe-task">Task ID<input id="recipe-task" value={draft.taskId} onChange={(event) => set('taskId', event.target.value)} placeholder="username~task-name" /></label>
      </div>
      <div className="v5-recipe-tools">
        <div>
          <strong>V5 schema and version tools</strong>
          <small>Discover an Apify resource, preview normalized rows, then checkpoint recipe versions before running production missions.</small>
        </div>
        <div className="button-row">
          <Button
            type="button"
            className="ghost"
            disabled={busy || v5Busy || (!draft.actorId.trim() && !draft.taskId.trim())}
            onClick={() => runV5Action(async () => {
              const next = await onDiscoverApifyResource({ actorId: draft.actorId, taskId: draft.taskId });
              setDiscovery(next);
              return next;
            })}
          >
            Discover schema
          </Button>
          <Button
            type="button"
            className="ghost"
            disabled={busy || v5Busy || Boolean(formError)}
            onClick={() => runV5Action(async () => {
              const next = await onTestRecipe(recipePayload());
              setTestResult(next);
              return next;
            })}
          >
            Test sample
          </Button>
          <Button
            type="button"
            className="ghost"
            disabled={busy || v5Busy || Boolean(formError)}
            onClick={() => runV5Action(() => onSaveRecipeVersion({
              recipeId: recipeIdFromDraft(draft, currentRecipe),
              version: {
                version: Number(currentRecipe?.version || 0) + 1,
                name: draft.name,
                input: JSON.parse(draft.inputJson || '{}'),
                mapper: JSON.parse(draft.mapperJson || '{}'),
                notes: 'Saved from V5 recipe builder',
              },
            }))}
          >
            Save version
          </Button>
        </div>
      </div>
      {discovery && (
        <div className="v5-recipe-discovery">
          <Badge tone="ready">{discovery.kind}</Badge>
          <strong>{discovery.title}</strong>
          <small>{discovery.warnings?.join(' ') || 'Schema scaffold loaded.'}</small>
          <Button
            type="button"
            className="ghost"
            onClick={() => {
              set('inputJson', JSON.stringify(discovery.inputTemplate || {}, null, 2));
              set('mapperJson', JSON.stringify(discovery.mapperTemplate || {}, null, 2));
            }}
          >
            Use discovered input
          </Button>
          <pre>{JSON.stringify({ inputTemplate: discovery.inputTemplate, mapperTemplate: discovery.mapperTemplate }, null, 2)}</pre>
        </div>
      )}
      {testResult && (
        <div className={`v5-recipe-discovery ${testResult.error ? 'warning' : ''}`}>
          <Badge tone={testResult.error ? 'warning' : 'ready'}>{testResult.error ? 'Test failed' : 'Sample ready'}</Badge>
          <strong>{testResult.error || `${testResult.normalizedSample?.length || 0} normalized sample rows`}</strong>
          {testResult.profile && <small>{testResult.profile.confidence * 100}% profile confidence / {testResult.profile.mapperWarnings?.join(' ') || 'mapper looks usable'}</small>}
        </div>
      )}
      <label htmlFor="recipe-proxy-note">Proxy and cost note<input id="recipe-proxy-note" value={draft.proxyNote} onChange={(event) => set('proxyNote', event.target.value)} placeholder="Residential proxy configured inside Actor input" /></label>
      <label htmlFor="recipe-input-json">Actor input JSON<textarea id="recipe-input-json" value={draft.inputJson} onChange={(event) => set('inputJson', event.target.value)} rows={9} aria-invalid={Boolean(formError)} aria-describedby={formError ? 'recipe-form-error' : undefined} /></label>
      <label htmlFor="recipe-mapper-json">Output mapper JSON<textarea id="recipe-mapper-json" value={draft.mapperJson} onChange={(event) => set('mapperJson', event.target.value)} rows={5} aria-invalid={Boolean(formError)} aria-describedby={formError ? 'recipe-form-error' : undefined} /></label>
      {formError && <p id="recipe-form-error" className="field-error" role="alert">{formError}</p>}
      <div className="button-row">
        <Button disabled={busy || Boolean(formError)} type="submit">Save recipe</Button>
        <Button type="button" className="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function AutomationView({ state, busy, onSaveRecipe, onRunRecipe, onDeleteRecipe, onDiscoverApifyResource, onTestRecipe, onSaveRecipeVersion }) {
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  return (
    <section className="view-grid automation-view">
      <div className="panel">
        <div className="panel-head">
          <div><h3>Apify Recipes</h3><p>Any platform means any Actor or saved task you configure.</p></div>
          <Button disabled={busy} onClick={() => setEditing({})}>New</Button>
        </div>
        {pendingDelete && (
          <div className="confirm-inline">
            <strong>Delete {pendingDelete.name}?</strong>
            <span>Runs and datasets stay, but this recipe preset will be removed.</span>
            <div className="button-row">
              <Button className="danger" disabled={busy} onClick={async () => {
                await onDeleteRecipe(pendingDelete.id);
                setPendingDelete(null);
              }}>Delete</Button>
              <Button className="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
            </div>
          </div>
        )}
        <div className="stack">
          {state.recipes.map((savedRecipe) => (
            <article className="recipe-card" key={savedRecipe.id}>
              <div>
                <Badge>{savedRecipe.platform}</Badge>
                <strong>{savedRecipe.name}</strong>
                <small>{savedRecipe.actorId || savedRecipe.taskId}</small>
              </div>
              <p>{savedRecipe.proxyNote || 'Proxy and sessions stay inside the Actor input.'}</p>
              <div className="button-row">
                <Button className="ghost" onClick={() => setEditing(savedRecipe)}>Edit</Button>
                <Button disabled={busy} onClick={() => onRunRecipe(savedRecipe.id)}>Run</Button>
                <Button className="ghost danger" disabled={busy} onClick={() => setPendingDelete(savedRecipe)}>Delete</Button>
              </div>
            </article>
          ))}
          {!state.recipes.length && <Empty title="No recipes saved" detail="Paste an Actor ID or task ID to create your first scraper workflow." action="New recipe" onAction={() => setEditing({})} />}
        </div>
      </div>
      <div className="panel">
        <h3>{editing?.id ? 'Edit Recipe' : 'Recipe Builder'}</h3>
        <RecipeForm
          busy={busy}
          recipe={editing}
          onCancel={() => setEditing(null)}
          onDiscoverApifyResource={onDiscoverApifyResource}
          onTestRecipe={onTestRecipe}
          onSaveRecipeVersion={onSaveRecipeVersion}
          onSave={async (nextRecipe) => {
            await onSaveRecipe(nextRecipe);
            setEditing(null);
          }}
        />
      </div>
    </section>
  );
}
