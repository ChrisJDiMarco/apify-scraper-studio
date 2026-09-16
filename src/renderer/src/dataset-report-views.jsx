import { useEffect, useMemo, useState } from 'react';
import { analysesForDataset, codexEventLabels } from '../../shared/analysis.js';
import { datasetItemKey, datasetItemSearchText } from '../../shared/dataset-view.js';
import REPORT_PRESETS from '../../shared/report-presets.json';
import { Badge, Button, Empty, formatDate, JsonBlock, label, number, short, statusTone } from './ui.jsx';

function selectRowFromKeyboard(event, select) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

export function DatasetsView({ state, selectedDatasetId, onDatasetSelect, payload, busy, onAnalyze, onExportDataset, onExportDatasetToSheets, onSearchEvidence, onNavigate }) {
  const selected = state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0];
  const [rawMode, setRawMode] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [visibleColumns, setVisibleColumns] = useState(['type', 'author', 'text', 'metrics']);
  const [savedFilters, setSavedFilters] = useState([]);
  const [compareMode, setCompareMode] = useState(false);
  const [evidenceMatches, setEvidenceMatches] = useState([]);
  const [windowStart, setWindowStart] = useState(0);
  const [selectedRowToken, setSelectedRowToken] = useState('');
  const items = payload?.items || [];
  const rawItems = payload?.rawItems || [];
  const sourceItems = rawMode ? rawItems : items;
  const typeOptions = useMemo(() => [...new Set(items.map((item) => item.type).filter(Boolean))].sort(), [items]);
  const columnOptions = useMemo(() => {
    const keys = new Set(['type', 'author', 'text', 'url', 'publishedAt', 'metrics']);
    for (const item of items.slice(0, 100)) Object.keys(item || {}).forEach((key) => keys.add(key));
    return Array.from(keys).sort();
  }, [items]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = sourceItems.filter((item) => {
    const matchesQuery = !normalizedQuery || datasetItemSearchText(item, rawMode).toLowerCase().includes(normalizedQuery);
    const matchesType = rawMode || typeFilter === 'all' || item.type === typeFilter;
    return matchesQuery && matchesType;
  });
  const tableScope = `${selected?.id || 'none'}:${rawMode ? 'raw' : 'normalized'}:${normalizedQuery}:${typeFilter}`;
  const windowSize = 90;
  const safeWindowStart = Math.min(windowStart, Math.max(0, visibleItems.length - windowSize));
  const renderedItems = visibleItems.slice(safeWindowStart, safeWindowStart + windowSize);
  const selectedIndex = renderedItems.findIndex((item, index) => `${tableScope}:${datasetItemKey(item, index)}` === selectedRowToken);
  const selectedPreviewIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedItem = renderedItems[selectedPreviewIndex] || null;
  const rawMatch = selectedItem && !rawMode ? rawItems.find((item, index) => datasetItemKey(item, index) === datasetItemKey(selectedItem, selectedPreviewIndex)) || rawItems[selectedPreviewIndex + safeWindowStart] : null;
  const selectedToken = selectedItem ? `${tableScope}:${datasetItemKey(selectedItem, selectedPreviewIndex)}` : '';

  function cellValue(item, column, index) {
    if (column === 'metrics') return rawMode ? index + 1 : `${number(item.metrics?.likes)}/${number(item.metrics?.comments)}/${number(item.metrics?.shares)}/${number(item.metrics?.views)}`;
    if (column === 'text') return short(rawMode ? item.text || item.body || item.content || item.title || datasetItemSearchText(item, true) : item.text, 130);
    const value = item?.[column];
    if (value && typeof value === 'object') return short(JSON.stringify(value), 90);
    return short(value, column === 'author' ? 28 : 90);
  }

  async function searchAllEvidence() {
    if (!onSearchEvidence || !query.trim()) return;
    setEvidenceMatches(await onSearchEvidence({ query, limit: 12 }) || []);
  }

  function saveCurrentFilter() {
    const labelText = `${query || 'All rows'} / ${typeFilter} / ${rawMode ? 'raw' : 'normalized'}`;
    setSavedFilters((current) => [{ id: `${Date.now()}`, label: labelText, query, typeFilter, rawMode }, ...current].slice(0, 5));
  }

  return (
    <section className="view-grid datasets-view">
      <div className="panel side-panel">
        <h3>Datasets</h3>
        <div className="stack">
          {state.datasets.map((dataset) => (
            <button className={`dataset-button ${selected?.id === dataset.id ? 'active' : ''}`} key={dataset.id} onClick={() => onDatasetSelect(dataset.id)}>
              <strong>{dataset.name}</strong>
              <small>{dataset.platform} - {number(dataset.itemCount)} items - {formatDate(dataset.createdAt)}</small>
            </button>
          ))}
          {!state.datasets.length && <Empty title="No datasets" detail="Run a recipe to pull data from Apify." action="Create recipe" onAction={() => onNavigate('automation')} />}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div><h3>{selected?.name || 'Dataset Preview'}</h3><p>{selected ? `${number(visibleItems.length)} of ${number(sourceItems.length)} visible` : 'Select a dataset'}</p></div>
          <div className="button-row">
            <Button className={rawMode ? 'ghost' : ''} disabled={!selected} onClick={() => setRawMode(false)}>Normalized</Button>
            <Button className={rawMode ? '' : 'ghost'} disabled={!selected} onClick={() => setRawMode(true)}>Raw</Button>
            <Button disabled={!selected || busy} onClick={() => onAnalyze(selected.id, 'tag')}>Tag</Button>
            <Button disabled={!selected || busy} onClick={() => onAnalyze(selected.id, 'thread')}>Threads</Button>
            <Button disabled={!selected || busy} onClick={() => onAnalyze(selected.id, 'report')}>Report</Button>
            <Button className="ghost" disabled={!selected || busy} onClick={() => onExportDataset(selected.id, 'jsonl')}>JSONL</Button>
            <Button className="ghost" disabled={!selected || busy} onClick={() => onExportDataset(selected.id, 'csv')}>CSV</Button>
            <Button className="ghost" disabled={!selected || busy || !state.keys?.GOOGLE_SHEETS_WEBHOOK_URL || !onExportDatasetToSheets} onClick={() => onExportDatasetToSheets(selected.id)}>Sheets</Button>
          </div>
        </div>
        <div className="dataset-tools">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search dataset rows" />
          <select value={typeFilter} disabled={rawMode} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <Button className="ghost" disabled={!query.trim()} onClick={saveCurrentFilter}>Save filter</Button>
          <Button className="ghost" disabled={!query.trim() || busy || !onSearchEvidence} onClick={searchAllEvidence}>Search all runs</Button>
          <Button className={compareMode ? '' : 'ghost'} disabled={!selected} onClick={() => setCompareMode((value) => !value)}>Compare raw</Button>
        </div>
        <div className="dataset-column-picker" aria-label="Visible dataset columns">
          {columnOptions.slice(0, 14).map((column) => (
            <label key={column}>
              <input
                type="checkbox"
                checked={visibleColumns.includes(column)}
                onChange={(event) => {
                  setVisibleColumns((current) => event.target.checked ? [...current, column] : current.filter((item) => item !== column));
                }}
              />
              {column}
            </label>
          ))}
        </div>
        {(savedFilters.length > 0 || evidenceMatches.length > 0) && (
          <div className="dataset-saved-filters">
            {savedFilters.map((filter) => (
              <button
                type="button"
                className="ghost"
                key={filter.id}
                onClick={() => {
                  setQuery(filter.query);
                  setTypeFilter(filter.typeFilter);
                  setRawMode(filter.rawMode);
                }}
              >
                {filter.label}
              </button>
            ))}
            {evidenceMatches.map((item) => <span className="chip" key={item.id}>{short(item.text || item.sourceUrl, 80)}</span>)}
          </div>
        )}
        <div className="dataset-window-tools">
          <span>{number(safeWindowStart + 1)}-{number(Math.min(safeWindowStart + windowSize, visibleItems.length))} of {number(visibleItems.length)}</span>
          <div className="button-row">
            <Button className="ghost" disabled={safeWindowStart === 0} onClick={() => setWindowStart(Math.max(0, safeWindowStart - windowSize))}>Previous</Button>
            <Button className="ghost" disabled={safeWindowStart + windowSize >= visibleItems.length} onClick={() => setWindowStart(safeWindowStart + windowSize)}>Next</Button>
          </div>
        </div>
        <div className="table-wrap tall">
          <table>
            <thead><tr>{visibleColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {renderedItems.map((item, index) => {
                const rowToken = `${tableScope}:${datasetItemKey(item, index)}`;
                const select = () => setSelectedRowToken(rowToken);
                return (
                  <tr
                    aria-selected={rowToken === selectedToken}
                    className={rowToken === selectedToken ? 'active-row' : ''}
                    key={rowToken}
                    onClick={select}
                    onKeyDown={(event) => selectRowFromKeyboard(event, select)}
                    tabIndex={0}
                  >
                    {visibleColumns.map((column) => <td key={column}>{cellValue(item, column, index + safeWindowStart)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleItems.length === 0 && sourceItems.length > 0 && <Empty title="No matching rows" detail="Clear search or type filters to inspect this dataset." />}
        {selected && sourceItems.length === 0 && <Empty title="Dataset is empty" detail="Run the recipe again or inspect the Actor mapper before analysis." action="Open recipes" onAction={() => onNavigate('automation')} />}
        {selectedItem && (
          <div className="dataset-preview">
            <div>
              <strong>Selected row</strong>
              <span>{safeWindowStart + selectedPreviewIndex + 1} of {number(visibleItems.length)}</span>
            </div>
            {compareMode && rawMatch ? (
              <div className="dataset-compare">
                <div><strong>Normalized</strong><JsonBlock value={selectedItem} /></div>
                <div><strong>Raw</strong><JsonBlock value={rawMatch} /></div>
              </div>
            ) : <JsonBlock value={selectedItem} />}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReportsView({ state, selectedDatasetId, onDatasetSelect, busy, onAnalyze, onReadAnalysis, onOpenAnalysisOutput, onRevealAnalysisOutput }) {
  const selectedDataset = state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0];
  const datasetId = selectedDataset?.id || '';
  const scopedAnalyses = analysesForDataset(state.analyses, datasetId);
  const reports = scopedAnalyses.filter((analysis) => analysis.kind === 'report');
  const intelligence = scopedAnalyses.filter((analysis) => analysis.kind !== 'report');
  const allAnalyses = [...reports, ...intelligence];
  const [selectedAnalysisId, setSelectedAnalysisId] = useState('');
  const [analysisOutput, setAnalysisOutput] = useState(null);
  const selectedAnalysis = allAnalyses.find((analysis) => analysis.id === selectedAnalysisId) || allAnalyses[0];
  const selectedHasFile = Boolean(selectedAnalysis?.reportPath || selectedAnalysis?.outputPath);
  const runReport = (presetId) => onAnalyze(datasetId, 'report', { reportPresetId: presetId });

  useEffect(() => {
    if (!allAnalyses.some((analysis) => analysis.id === selectedAnalysisId)) setSelectedAnalysisId(allAnalyses[0]?.id || '');
    if (!selectedAnalysisId && allAnalyses[0]) setSelectedAnalysisId(allAnalyses[0].id);
  }, [selectedAnalysisId, allAnalyses.map((analysis) => analysis.id).join('|')]);

  useEffect(() => {
    if (!selectedAnalysis) {
      setAnalysisOutput(null);
      return;
    }
    let cancelled = false;
    setAnalysisOutput({ loading: true });
    onReadAnalysis(selectedAnalysis.id)
      .then((output) => {
        if (!cancelled) setAnalysisOutput(output);
      })
      .catch((err) => {
        if (!cancelled) setAnalysisOutput({ error: err.message || String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAnalysis?.id, onReadAnalysis]);

  return (
    <section className="view-grid reports-view">
      <div className="panel">
        <div className="panel-head">
          <div><h3>Codex Reports</h3><p>{selectedDataset ? selectedDataset.name : 'Select a dataset to run Codex analysis.'}</p></div>
          <div className="button-row">
            <select className="context-select" value={datasetId} disabled={!state.datasets.length || busy} onChange={(event) => onDatasetSelect(event.target.value)}>
              {state.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
            </select>
            <Button disabled={!datasetId || busy} onClick={() => runReport(REPORT_PRESETS[0].id)}>New report</Button>
          </div>
        </div>
        <div className="report-preset-grid">
          {REPORT_PRESETS.map((preset) => (
            <Button className="report-preset" disabled={!datasetId || busy} key={preset.id} onClick={() => runReport(preset.id)}>
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </Button>
          ))}
        </div>
        <AnalysisList analyses={reports} selectedId={selectedAnalysis?.id} onSelect={setSelectedAnalysisId} onRetry={onAnalyze} busy={busy} empty="Run a dataset report to create markdown and JSON output." />
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Tags and Threads</h3>
          <div className="button-row">
            <Button disabled={!datasetId || busy} onClick={() => onAnalyze(datasetId, 'tag')}>Tag</Button>
            <Button disabled={!datasetId || busy} onClick={() => onAnalyze(datasetId, 'thread')}>Thread</Button>
          </div>
        </div>
        <AnalysisList analyses={intelligence} selectedId={selectedAnalysis?.id} onSelect={setSelectedAnalysisId} onRetry={onAnalyze} busy={busy} empty="Tags, thread summaries, and schema validation status appear here." />
      </div>
      <div className="panel analysis-output span-all">
        <div className="panel-head">
          <div><h3>Output Viewer</h3><p>{selectedAnalysis ? `${label(selectedAnalysis.kind)} / ${selectedAnalysis.status}` : 'No Codex job selected'}</p></div>
          <div className="button-row">
            <Button className="ghost" disabled={!selectedHasFile || busy} onClick={() => onOpenAnalysisOutput(selectedAnalysis.id)}>Open</Button>
            <Button className="ghost" disabled={!selectedHasFile || busy} onClick={() => onRevealAnalysisOutput(selectedAnalysis.id)}>Reveal</Button>
            {selectedAnalysis?.status === 'failed' && <Button disabled={busy || !selectedAnalysis.datasetId} onClick={() => onAnalyze(selectedAnalysis.datasetId, selectedAnalysis.kind, { reportPresetId: selectedAnalysis.reportPresetId })}>Retry</Button>}
          </div>
        </div>
        <AnalysisOutput output={analysisOutput} />
      </div>
    </section>
  );
}

function AnalysisList({ analyses, selectedId, onSelect, onRetry, busy, empty }) {
  return (
    <div className="stack">
      {analyses.map((analysis) => (
        <article className={`analysis-card ${selectedId === analysis.id ? 'active' : ''}`} key={analysis.id}>
          <div className="analysis-head">
            <Badge tone={statusTone(analysis.status)}>{analysis.status}</Badge>
            <strong>{analysis.reportPresetName || label(analysis.kind)}</strong>
            <span>{formatDate(analysis.startedAt)}</span>
          </div>
          <p>{short(analysis.error || analysis.preview || analysis.outputPath || 'Running', 220)}</p>
          {(analysis.reportPath || analysis.outputPath) && <code>{analysis.reportPath || analysis.outputPath}</code>}
          <div className="button-row">
            <Button className="ghost" onClick={() => onSelect(analysis.id)}>View</Button>
            {analysis.status === 'failed' && <Button disabled={busy || !analysis.datasetId} onClick={() => onRetry(analysis.datasetId, analysis.kind, { reportPresetId: analysis.reportPresetId })}>Retry</Button>}
          </div>
        </article>
      ))}
      {!analyses.length && <Empty title="No Codex output" detail={empty} />}
    </div>
  );
}

function AnalysisOutput({ output }) {
  if (!output) return <Empty title="No output selected" detail="Select a Codex job to inspect its saved files." />;
  if (output.loading) return <Empty title="Loading output" detail="Reading the local Codex JSON and markdown files." />;
  if (output.error) return <Empty title="Output unavailable" detail={output.error} />;
  const eventLabels = codexEventLabels(output.events || []);
  return (
    <div className="analysis-output-body">
      {output.context && (
        <div className="analysis-context">
          <strong>Run Context</strong>
          <div>
            <Badge tone={output.context.profile?.health?.tone || 'neutral'}>{output.context.profile?.health?.label || output.context.run?.kind || 'Context'}</Badge>
            <small>{short(output.context.profile?.summary || output.context.dataset?.name || 'Saved Codex context', 180)}</small>
          </div>
        </div>
      )}
      {output.markdown && <pre className="markdown-block">{output.markdown}</pre>}
      {output.output && <JsonBlock value={output.output} />}
      {output.prompt && (
        <details className="prompt-details">
          <summary>Prompt and run rules</summary>
          <pre>{output.prompt}</pre>
        </details>
      )}
      {(eventLabels.length > 0 || output.stderr) && (
        <div className="codex-log">
          <strong>Codex Run Log</strong>
          {eventLabels.map((event, index) => <small key={`${event}-${index}`}>{short(event, 180)}</small>)}
          {output.stderr && <pre>{output.stderr}</pre>}
        </div>
      )}
      {!output.markdown && !output.output && <Empty title="No saved output" detail="This job has not produced a schema-valid file yet." />}
    </div>
  );
}
