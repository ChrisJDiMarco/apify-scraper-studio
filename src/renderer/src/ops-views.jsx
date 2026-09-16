import { useEffect, useState } from 'react';
import { latestAnalysisForDataset } from '../../shared/analysis.js';
import { groupThreads } from '../../shared/dashboard.js';
import { runDurationLabel, runRecipeLabel, runSearchText } from '../../shared/run-view.js';
import { Badge, Button, Empty, formatDate, JsonBlock, number, short, statusTone } from './ui.jsx';

function selectFromKeyboard(event, select) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

function ThreadBulletGroup({ title, items = [] }) {
  if (!items.length) return null;
  return (
    <div className="thread-bullets">
      <span>{title}</span>
      {items.slice(0, 3).map((item, index) => <small key={`${title}-${index}`}>{short(item, 120)}</small>)}
    </div>
  );
}

function threadOutputStats(summaries) {
  const count = (key) => summaries.reduce((total, thread) => total + (thread[key]?.length || 0), 0);
  return `${summaries.length} summaries / ${count('notableArguments')} arguments / ${count('objections')} objections / ${count('leads')} leads`;
}

function ThreadIntelligence({ analysis, output, busy, onOpenAnalysisOutput, onRevealAnalysisOutput }) {
  if (!analysis) return <Empty title="No Codex thread summary" detail="Run Summarize threads to create AI conversation summaries for this dataset." />;
  if (analysis.status === 'failed') return <Empty title="Thread summary failed" detail={analysis.error || 'Retry the thread analysis job when you are ready.'} />;
  if (analysis.status === 'running') return <Empty title="Thread summary running" detail="Codex is grouping conversations for this dataset." />;
  if (output?.loading) return <Empty title="Loading thread summary" detail="Reading the saved Codex thread output." />;
  if (output?.error) return <Empty title="Thread summary unavailable" detail={output.error} />;

  const summaries = output?.output?.threads || [];
  if (!summaries.length) return <Empty title="No saved thread summaries" detail="The latest Codex job has not produced thread output yet." />;

  return (
    <div className="thread-intel">
      <div className="panel-head">
        <div>
          <h3>Codex Thread Intelligence</h3>
          <p>{threadOutputStats(summaries)}{analysis.eventCount ? ` / ${analysis.eventCount} Codex events` : ''}</p>
        </div>
        <div className="button-row">
          <Button className="ghost" disabled={busy || !analysis.outputPath} onClick={() => onOpenAnalysisOutput(analysis.id)}>Open</Button>
          <Button className="ghost" disabled={busy || !analysis.outputPath} onClick={() => onRevealAnalysisOutput(analysis.id)}>Reveal</Button>
          <Badge tone={statusTone(analysis.status)}>{analysis.status}</Badge>
        </div>
      </div>
      <div className="thread-summary-grid">
        {summaries.slice(0, 6).map((thread) => (
          <article className="thread-summary-card" key={thread.threadId}>
            <div>
              <Badge>{thread.threadId}</Badge>
              <strong>{thread.title}</strong>
            </div>
            <p>{short(thread.summary, 220)}</p>
            <ThreadBulletGroup title="Arguments" items={thread.notableArguments} />
            <ThreadBulletGroup title="Objections" items={thread.objections} />
            <ThreadBulletGroup title="Leads" items={thread.leads} />
            <ThreadBulletGroup title="Risks" items={thread.risks} />
          </article>
        ))}
      </div>
    </div>
  );
}

export function ThreadsView({ payload, selectedDataset, state, onAnalyze, onReadAnalysis, onOpenAnalysisOutput, onRevealAnalysisOutput, busy }) {
  const threads = groupThreads(payload?.items || []).slice(0, 40);
  const latestThreadAnalysis = latestAnalysisForDataset(state?.analyses || [], selectedDataset?.id || '', 'thread');
  const [threadOutput, setThreadOutput] = useState(null);

  useEffect(() => {
    if (!latestThreadAnalysis?.id || latestThreadAnalysis.status !== 'succeeded') {
      setThreadOutput(null);
      return undefined;
    }

    let cancelled = false;
    setThreadOutput({ loading: true });
    onReadAnalysis(latestThreadAnalysis.id)
      .then((output) => {
        if (!cancelled) setThreadOutput(output);
      })
      .catch((error) => {
        if (!cancelled) setThreadOutput({ error: error.message || String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [latestThreadAnalysis?.id, latestThreadAnalysis?.status, onReadAnalysis]);

  return (
    <section className="panel full">
      <div className="panel-head">
        <div><h3>Thread View</h3><p>{selectedDataset ? selectedDataset.name : 'Select or run a dataset to inspect conversations.'}</p></div>
        <Button disabled={!selectedDataset || busy} onClick={() => onAnalyze(selectedDataset.id, 'thread')}>Summarize threads</Button>
      </div>
      <ThreadIntelligence
        analysis={latestThreadAnalysis}
        output={threadOutput}
        busy={busy}
        onOpenAnalysisOutput={onOpenAnalysisOutput}
        onRevealAnalysisOutput={onRevealAnalysisOutput}
      />
      <div className="thread-list">
        {threads.map((thread) => (
          <article className="thread-card" key={thread.id}>
            <div className="thread-root">
              <Badge>{thread.root?.platform || selectedDataset?.platform || 'thread'}</Badge>
              <strong>{short(thread.root?.text || thread.root?.url || thread.id, 180)}</strong>
              <small>{thread.root?.author || thread.id}</small>
            </div>
            <div className="thread-replies">
              {thread.replies.slice(0, 4).map((reply) => (
                <p key={reply.id}><span>{reply.author || 'reply'}</span>{short(reply.text || reply.url || reply.id, 150)}</p>
              ))}
              {thread.replies.length > 4 && <small>{thread.replies.length - 4} more replies</small>}
            </div>
          </article>
        ))}
        {!threads.length && <Empty title="No threads yet" detail="Run a recipe that returns posts and comments, then this view will group them." />}
      </div>
    </section>
  );
}

export function RunsView({ state, busy, onRunRecipe, onDatasetSelect, onNavigate }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRunId, setSelectedRunId] = useState('');
  const recipes = new Map(state.recipes.map((recipe) => [recipe.id, recipe]));
  const normalizedQuery = query.trim().toLowerCase();
  const statusOptions = [...new Set(state.runs.map((run) => run.status).filter(Boolean))].sort();
  const runs = state.runs.filter((run) => {
    const recipe = recipes.get(run.recipeId);
    const matchesStatus = statusFilter === 'all' || run.status === statusFilter;
    const matchesQuery = !normalizedQuery || runSearchText(run, recipe).toLowerCase().includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });
  const selectedRun = runs.find((run) => run.id === selectedRunId) || runs[0] || null;
  const selectedRecipe = selectedRun ? recipes.get(selectedRun.recipeId) : null;

  return (
    <section className="panel full">
      <div className="panel-head">
        <div><h3>Runs</h3><p>Live run status, dataset counts, and quick reruns for saved Apify recipes.</p></div>
        <Button onClick={() => onNavigate('automation')}>New run</Button>
      </div>
      <div className="dataset-tools">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs, datasets, errors" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      <div className="table-wrap tall">
        <table>
          <thead><tr><th>Status</th><th>Platform</th><th>Recipe</th><th>Items</th><th>Duration</th><th>Started</th><th>Result</th><th></th></tr></thead>
          <tbody>
            {runs.map((run) => {
              const recipe = recipes.get(run.recipeId);
              const select = () => setSelectedRunId(run.id);
              return (
                <tr
                  aria-selected={selectedRun?.id === run.id}
                  className={selectedRun?.id === run.id ? 'active-row' : ''}
                  key={run.id}
                  onClick={select}
                  onKeyDown={(event) => selectFromKeyboard(event, select)}
                  tabIndex={0}
                >
                  <td><Badge tone={statusTone(run.status)}>{run.status}</Badge></td>
                  <td>{run.platform}</td>
                  <td>{runRecipeLabel(run, recipe)}</td>
                  <td>{number(run.itemCount)}</td>
                  <td>{runDurationLabel(run)}</td>
                  <td>{formatDate(run.startedAt)}</td>
                  <td>{run.error ? short(run.error, 90) : run.defaultDatasetId || run.datasetId || 'Running'}</td>
                  <td>{recipe && <Button disabled={busy} onClick={() => onRunRecipe(recipe.id)}>Rerun</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedRun && (
        <div className="run-detail">
          <div className="panel-head">
            <div>
              <h3>{runRecipeLabel(selectedRun, selectedRecipe)}</h3>
              <p>{selectedRun.error || selectedRun.defaultDatasetId || selectedRun.datasetId || 'Run is still collecting data.'}</p>
            </div>
            <div className="button-row">
              {selectedRecipe && <Button disabled={busy} onClick={() => onRunRecipe(selectedRecipe.id)}>Rerun</Button>}
              {selectedRun.datasetId && <Button className="ghost" onClick={() => { onDatasetSelect(selectedRun.datasetId); onNavigate('datasets'); }}>Open dataset</Button>}
            </div>
          </div>
          <div className="run-facts">
            <span><strong>Status</strong>{selectedRun.status}</span>
            <span><strong>Items</strong>{number(selectedRun.itemCount)}</span>
            <span><strong>Duration</strong>{runDurationLabel(selectedRun) || 'Not finished'}</span>
            <span><strong>Started</strong>{formatDate(selectedRun.startedAt)}</span>
          </div>
          <JsonBlock value={selectedRun} />
        </div>
      )}
      {runs.length === 0 && state.runs.length > 0 && <Empty title="No matching runs" detail="Clear search or status filters to inspect run history." />}
      {!state.runs.length && <Empty title="No runs yet" detail="Create a recipe, then run it to capture datasets from Apify." action="Create recipe" onAction={() => onNavigate('automation')} />}
    </section>
  );
}
