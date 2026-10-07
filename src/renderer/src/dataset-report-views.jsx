import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, ArrowDownToLine, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Database, FileText, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { analysesForDataset, codexEventLabels } from '../../shared/analysis.js';
import { datasetItemKey, datasetItemSearchText } from '../../shared/dataset-view.js';
import REPORT_PRESETS from '../../shared/report-presets.json';
import { Badge, Button, Empty, formatDate, JsonBlock, label, number, short, statusTone } from './ui.jsx';
import './data-workspace.css';
import { MarkdownContent } from './markdown-content.jsx';
import { CoverageReviewPanel } from './report-review-view.jsx';

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
  const [evidenceStatus, setEvidenceStatus] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [windowStart, setWindowStart] = useState(0);
  const [selectedRowToken, setSelectedRowToken] = useState('');
  const evidenceRequest = useRef(0);
  const items = payload?.items || [];
  const rawItems = payload?.rawItems || [];
  const sourceItems = rawMode ? rawItems : items;
  const typeOptions = useMemo(() => [...new Set(items.map((item) => item?.type).filter(Boolean))].sort(), [items]);
  const columnOptions = useMemo(() => {
    const keys = new Set(['type', 'author', 'text', 'url', 'publishedAt', 'metrics']);
    for (const item of sourceItems.slice(0, 100)) Object.keys(item || {}).forEach((key) => keys.add(key));
    return Array.from(keys).sort();
  }, [sourceItems]);
  const normalizedQuery = query.trim().toLowerCase();
  // Keep the source index through filtering and pagination. Normalization is a 1:1 map;
  // IDs may be prefixed or absent, so matching a filtered row by its display index is unsafe.
  const visibleRows = sourceItems.map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) => {
    const matchesQuery = !normalizedQuery || datasetItemSearchText(item, rawMode).toLowerCase().includes(normalizedQuery);
    const matchesType = rawMode || typeFilter === 'all' || item?.type === typeFilter;
    return matchesQuery && matchesType;
  });
  const tableScope = `${selected?.id || 'none'}:${rawMode ? 'raw' : 'normalized'}:${normalizedQuery}:${typeFilter}`;
  const windowSize = 90;
  const lastPageStart = Math.max(0, Math.floor((visibleRows.length - 1) / windowSize) * windowSize);
  const safeWindowStart = Math.min(windowStart, lastPageStart);
  const renderedRows = visibleRows.slice(safeWindowStart, safeWindowStart + windowSize);
  const rowTokenFor = ({ item, sourceIndex }) => `${tableScope}:${datasetItemKey(item, sourceIndex)}:${sourceIndex}`;
  const selectedIndex = renderedRows.findIndex((row) => rowTokenFor(row) === selectedRowToken);
  const selectedPreviewIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedRow = renderedRows[selectedPreviewIndex];
  const selectedItem = selectedRow?.item;
  const rawMatch = selectedRow && !rawMode ? rawItems[selectedRow.sourceIndex] : null;
  const selectedToken = selectedRow ? rowTokenFor(selectedRow) : '';

  useEffect(() => {
    setQuery('');
    setTypeFilter('all');
    setRawMode(false);
    setCompareMode(false);
    setSavedFilters([]);
  }, [selected?.id]);

  useEffect(() => {
    setWindowStart(0);
    setSelectedRowToken('');
    setEvidenceMatches([]);
    setEvidenceStatus('');
    setEvidenceError('');
    evidenceRequest.current += 1;
    return () => { evidenceRequest.current += 1; };
  }, [tableScope]);

  function cellValue(item, column) {
    if (column === 'metrics' && !rawMode) return <span className="data-engagement"><span>{number(item?.metrics?.likes)} likes · {number(item?.metrics?.comments)} comments</span><small>{number(item?.metrics?.shares)} shares · {number(item?.metrics?.views)} views</small></span>;
    if (column === 'text') return short(rawMode ? item?.text || item?.body || item?.content || item?.title || datasetItemSearchText(item, true) : item?.text, 130) || '—';
    const value = item?.[column];
    if (value && typeof value === 'object') return short(JSON.stringify(value), 90);
    return value === 0 ? '0' : short(value, column === 'author' ? 28 : 90) || '—';
  }

  async function searchAllEvidence() {
    if (!onSearchEvidence || !query.trim()) return;
    const request = ++evidenceRequest.current;
    setEvidenceError('');
    setEvidenceStatus('searching');
    try {
      const matches = await onSearchEvidence({ query: query.trim(), limit: 12 });
      if (request !== evidenceRequest.current) return;
      setEvidenceMatches(Array.isArray(matches) ? matches : []);
      setEvidenceStatus('complete');
    } catch (error) {
      if (request !== evidenceRequest.current) return;
      setEvidenceMatches([]);
      setEvidenceError(error?.message || 'Search could not finish. Try again.');
      setEvidenceStatus('');
    }
  }

  function saveCurrentFilter() {
    const labelText = `${query || 'All rows'} · ${typeFilter === 'all' ? 'All types' : typeFilter} · ${rawMode ? 'Raw' : 'Normalized'}`;
    setSavedFilters((current) => [{ id: `${Date.now()}`, label: labelText, query, typeFilter, rawMode }, ...current].slice(0, 5));
  }

  if (!selected) return (
    <section className="panel data-welcome">
      <span className="data-welcome-icon"><Database size={28} aria-hidden="true" /></span>
      <span className="data-eyebrow">YOUR DATA, IN ONE PLACE</span>
      <h2>Good insights start with good data.</h2>
      <p>Run your first scraper to collect posts, conversations, or leads. Then explore the results, export a spreadsheet, or turn them into an AI report.</p>
      <div className="button-row"><Button onClick={() => onNavigate('automation')}>Start a scraper <ArrowRight size={16} aria-hidden="true" /></Button><Button className="ghost" onClick={() => onNavigate('imports')}>Import data</Button></div>
      <div className="data-welcome-steps"><span><b>1</b> Choose a scraper</span><span><b>2</b> Collect your data</span><span><b>3</b> Find the insight</span></div>
    </section>
  );

  return (
    <section className="view-grid datasets-view data-workspace">
      <div className="panel side-panel">
        <div className="panel-head"><h3>Saved datasets</h3><Badge>{number(state.datasets.length)}</Badge></div>
        <div className="stack">
          {state.datasets.map((dataset) => (
            <button type="button" aria-pressed={selected.id === dataset.id} className={`dataset-button ${selected.id === dataset.id ? 'active' : ''}`} key={dataset.id} onClick={() => onDatasetSelect(dataset.id)}>
              <strong>{dataset.name}</strong>
              <small>{label(dataset.platform)} · {number(dataset.itemCount)} rows</small>
              <small>{formatDate(dataset.createdAt)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="panel data-main-panel">
        <div className="panel-head">
          <div><span className="data-eyebrow">DATA EXPLORER</span><h3>{selected.name}</h3><p>{number(sourceItems.length)} rows · {label(selected.platform)}</p></div>
          <div className="button-row">
            <Button className="ghost" disabled={busy} onClick={() => onNavigate('imports')}>Import data</Button>
            <details className="data-export-menu">
              <summary><ArrowDownToLine size={15} aria-hidden="true" /> Export <ChevronDown size={14} aria-hidden="true" /></summary>
              <div className="data-export-options">
                <Button className="ghost" disabled={busy || !sourceItems.length} onClick={() => onExportDataset(selected.id, 'csv')}>CSV spreadsheet</Button>
                <Button className="ghost" disabled={busy || !sourceItems.length} onClick={() => onExportDataset(selected.id, 'jsonl')}>JSONL data</Button>
                <Button className="ghost" disabled={busy || !sourceItems.length || !state.keys?.GOOGLE_SHEETS_WEBHOOK_URL || !onExportDatasetToSheets} onClick={() => onExportDatasetToSheets(selected.id)}>Google Sheets</Button>
                {!state.keys?.GOOGLE_SHEETS_WEBHOOK_URL && <small>Connect Google Sheets in Settings to enable it.</small>}
              </div>
            </details>
            <Button disabled={busy || !items.length} onClick={() => onAnalyze(selected.id, 'report')}><Sparkles size={15} aria-hidden="true" /> Generate report</Button>
          </div>
        </div>
        {items.length > 0 || rawItems.length > 0 ? <>
          <div className="data-filter-bar">
            <div className="data-search"><Search size={16} aria-hidden="true" /><input aria-label="Search dataset rows" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your data…" /></div>
            <select aria-label="Filter by type" value={typeFilter} disabled={rawMode} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All types</option>
              {typeOptions.map((type) => <option key={type} value={type}>{label(type)}</option>)}
            </select>
            <div className="data-mode-switch" aria-label="Dataset format">
              <Button aria-pressed={!rawMode} className={rawMode ? 'ghost' : 'active'} onClick={() => setRawMode(false)}>Normalized</Button>
              <Button aria-pressed={rawMode} className={rawMode ? 'active' : 'ghost'} onClick={() => setRawMode(true)}>Raw</Button>
            </div>
          </div>
          <details className="data-advanced" key={selected.id}>
            <summary><SlidersHorizontal size={14} aria-hidden="true" /> View options & advanced tools</summary>
            <div className="data-advanced-body">
              <div><strong>Visible columns</strong><div className="dataset-column-picker" aria-label="Visible dataset columns">
                {columnOptions.map((column) => <label key={column}><input type="checkbox" checked={visibleColumns.includes(column)} disabled={visibleColumns.length === 1 && visibleColumns.includes(column)} onChange={(event) => setVisibleColumns((current) => event.target.checked ? [...current, column] : current.filter((item) => item !== column))} />{label(column)}</label>)}
              </div></div>
              <div className="button-row">
                <Button className="ghost" disabled={!query.trim() && typeFilter === 'all'} onClick={saveCurrentFilter}>Save filter</Button>
                <Button className="ghost" disabled={!query.trim() || busy || evidenceStatus === 'searching' || !onSearchEvidence} onClick={searchAllEvidence}>{evidenceStatus === 'searching' ? 'Searching…' : 'Search all runs'}</Button>
                <Button aria-pressed={compareMode} className={compareMode ? '' : 'ghost'} disabled={rawMode} onClick={() => setCompareMode((value) => !value)}>Compare raw</Button>
                <Button className="ghost" disabled={busy || !items.length} onClick={() => onAnalyze(selected.id, 'tag')}>Add AI tags</Button>
                <Button className="ghost" disabled={busy || !items.length} onClick={() => onAnalyze(selected.id, 'thread')}>Summarize threads</Button>
              </div>
              {savedFilters.length > 0 && <div className="dataset-saved-filters">{savedFilters.map((filter) => <button type="button" className="ghost" key={filter.id} onClick={() => { setQuery(filter.query); setTypeFilter(filter.typeFilter); setRawMode(filter.rawMode); }}>{filter.label}</button>)}</div>}
              {evidenceError && <p className="error-line" role="alert">{evidenceError}</p>}
              {evidenceStatus === 'complete' && <div className="data-evidence-results" role="status"><strong>{evidenceMatches.length ? `${number(evidenceMatches.length)} matches across your runs` : 'No matches across your runs'}</strong>{evidenceMatches.map((item, index) => <p key={item.id || index}>{short(item.text || item.sourceUrl, 180)}</p>)}</div>}
            </div>
          </details>
          {visibleRows.length > 0 ? <>
            <div className="table-wrap tall">
              <table>
                <thead><tr>{visibleColumns.map((column) => <th key={column}>{column === 'metrics' ? 'Engagement' : label(column)}</th>)}</tr></thead>
                <tbody>{renderedRows.map((row) => {
                  const rowToken = rowTokenFor(row);
                  const select = () => setSelectedRowToken(rowToken);
                  return <tr aria-selected={rowToken === selectedToken} className={rowToken === selectedToken ? 'active-row' : ''} key={rowToken} onClick={select} onKeyDown={(event) => selectRowFromKeyboard(event, select)} tabIndex={0}>{visibleColumns.map((column) => <td key={column}>{cellValue(row.item, column)}</td>)}</tr>;
                })}</tbody>
              </table>
            </div>
            <div className="dataset-window-tools">
              <span>{number(safeWindowStart + 1)}–{number(Math.min(safeWindowStart + windowSize, visibleRows.length))} of {number(visibleRows.length)} rows</span>
              {visibleRows.length > windowSize && <div className="button-row"><Button className="ghost" disabled={safeWindowStart === 0} onClick={() => setWindowStart(Math.max(0, safeWindowStart - windowSize))}><ChevronLeft size={14} aria-hidden="true" />Previous</Button><Button className="ghost" disabled={safeWindowStart + windowSize >= visibleRows.length} onClick={() => setWindowStart(safeWindowStart + windowSize)}>Next<ChevronRight size={14} aria-hidden="true" /></Button></div>}
            </div>
          </> : <Empty title="No matching rows" detail="Try another search or clear your filters to see every row." action="Clear filters" onAction={() => { setQuery(''); setTypeFilter('all'); }} />}
          {selectedRow && <details className="data-row-detail" key={tableScope} open={compareMode || undefined}>
            <summary><span>Selected row <small>{number(safeWindowStart + selectedPreviewIndex + 1)} of {number(visibleRows.length)}</small></span><span>View details <ChevronDown size={14} aria-hidden="true" /></span></summary>
            {compareMode && rawMatch != null ? <div className="dataset-compare"><div><strong>Normalized</strong><JsonBlock value={selectedItem} /></div><div><strong>Raw</strong><JsonBlock value={rawMatch} /></div></div> : <JsonBlock value={selectedItem} />}
          </details>}
        </> : <Empty title="Dataset is empty" detail="This run did not return any rows. Adjust your scraper inputs and try again." action="Open recipes" onAction={() => onNavigate('automation')} />}
      </div>
    </section>
  );
}

export function ReportsView({ state, selectedDatasetId, initialReportPresetId, initialAnalysisId, onDatasetSelect, busy, onAnalyze, onReadAnalysis, onReadResearchReview, onSaveResearchReview, onExportResearchReview, onOpenAnalysisOutput, onRevealAnalysisOutput, onNavigate }) {
  const selectedDataset = state.datasets.find((dataset) => dataset.id === selectedDatasetId) || state.datasets[0];
  const datasetId = selectedDataset?.id || '';
  const scopedAnalyses = analysesForDataset(state.analyses, datasetId);
  const reports = scopedAnalyses.filter((analysis) => analysis.kind === 'report');
  const intelligence = scopedAnalyses.filter((analysis) => analysis.kind !== 'report');
  const allAnalyses = [...reports, ...intelligence];
  const [selectedAnalysisId, setSelectedAnalysisId] = useState('');
  const [analysisOutput, setAnalysisOutput] = useState(null);
  const [presetId, setPresetId] = useState(REPORT_PRESETS[0].id);
  const suggestedPresetId = REPORT_PRESETS.some((preset) => preset.id === initialReportPresetId) ? initialReportPresetId : selectedDataset?.marketingBrief?.reportPresetId || REPORT_PRESETS[0].id;
  useEffect(() => { setPresetId(suggestedPresetId); }, [datasetId, suggestedPresetId]);
  const selectedPreset = REPORT_PRESETS.find((preset) => preset.id === presetId) || REPORT_PRESETS[0];
  const selectedAnalysis = allAnalyses.find((analysis) => analysis.id === selectedAnalysisId) || allAnalyses[0];
  const selectedHasFile = Boolean(selectedAnalysis?.reportPath || selectedAnalysis?.outputPath);
  const runReport = (reportPresetId) => onAnalyze(datasetId, 'report', { reportPresetId });

  useEffect(() => {
    if (initialAnalysisId && allAnalyses.some((analysis) => analysis.id === initialAnalysisId)) setSelectedAnalysisId(initialAnalysisId);
  }, [datasetId, initialAnalysisId]);

  useEffect(() => {
    if (!allAnalyses.some((analysis) => analysis.id === selectedAnalysisId)) setSelectedAnalysisId(allAnalyses.find((analysis) => analysis.id === initialAnalysisId)?.id || allAnalyses[0]?.id || '');
  }, [selectedAnalysisId, allAnalyses.map((analysis) => analysis.id).join('|')]);

  useEffect(() => {
    if (!selectedAnalysis) {
      setAnalysisOutput(null);
      return;
    }
    let cancelled = false;
    setAnalysisOutput({ loading: true });
    Promise.resolve().then(() => onReadAnalysis(selectedAnalysis.id))
      .then((output) => { if (!cancelled) setAnalysisOutput(output); })
      .catch((err) => { if (!cancelled) setAnalysisOutput({ error: err?.message || String(err) }); });
    return () => { cancelled = true; };
  }, [selectedAnalysis?.id, onReadAnalysis]);

  if (!datasetId) return (
    <section className="panel data-welcome">
      <span className="data-welcome-icon"><FileText size={28} aria-hidden="true" /></span>
      <span className="data-eyebrow">FROM DATA TO DIRECTION</span>
      <h2>Your next insight is waiting.</h2>
      <p>Collect a dataset, then let your AI assistant find trends, leads, and opportunities inside it. Every report stays connected to the data behind it.</p>
      <Button onClick={() => onNavigate?.('automation')}>Start a scraper <ArrowRight size={16} aria-hidden="true" /></Button>
      <div className="data-welcome-steps"><span><b>1</b> Collect a dataset</span><span><b>2</b> Choose your question</span><span><b>3</b> Get an AI report</span></div>
    </section>
  );

  return (
    <section className="view-grid reports-view report-workspace">
      <div className="panel report-builder">
        <span className="data-eyebrow">MAKE SENSE OF YOUR DATA</span>
        <h3>Create a report</h3>
        <p>Choose your data and what you want to learn. AI will turn the results into a useful starting point.</p>
        <label className="report-field">Dataset<select value={datasetId} disabled={busy} onChange={(event) => onDatasetSelect(event.target.value)}>{state.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {number(dataset.itemCount)} rows</option>)}</select></label>
        <label className="report-field">What do you want to learn?<select value={presetId} disabled={busy} onChange={(event) => setPresetId(event.target.value)}>{REPORT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <p className="report-helper">{state.settings?.aiProvider === 'codex' ? 'Codex CLI' : `Claude CLI · ${state.settings?.aiModel || 'claude-opus-5-5'}`}</p><p className="report-preset-description">{selectedPreset.description}</p>
        {selectedDataset.marketingBrief && <div className="report-brief-context"><strong>{selectedDataset.marketingBrief.brand}</strong><p>{selectedDataset.marketingBrief.decision}</p>{selectedDataset.marketingBrief.audience && <small>Audience: {selectedDataset.marketingBrief.audience}</small>}<p className="report-helper">Your saved research context will guide this report. Review its citations and coverage before sharing.</p></div>}
        <Button disabled={busy || selectedDataset.itemCount === 0} onClick={() => runReport(presetId)}><Sparkles size={16} aria-hidden="true" /> Generate report</Button>
        <Button className="ghost" disabled={busy || selectedDataset.itemCount === 0} onClick={() => onNavigate?.('chat', { datasetId })}><MessageSquare size={16} aria-hidden="true" />Ask questions instead</Button>
        {selectedDataset.itemCount === 0 && <p className="report-helper">This dataset has no rows. Choose another dataset or <button className="data-inline-link" onClick={() => onNavigate?.('automation')}>run a scraper</button>.</p>}
        <div className="report-history-head"><h3>Report history</h3><Badge>{number(reports.length)}</Badge></div>
        <AnalysisList analyses={reports} selectedId={selectedAnalysis?.id} onSelect={setSelectedAnalysisId} onRetry={onAnalyze} busy={busy} empty="Your reports for this dataset will appear here." />
        <details className="data-advanced report-other-tools">
          <summary><SlidersHorizontal size={14} aria-hidden="true" /> Other analysis tools</summary>
          <div className="data-advanced-body">
            <p>Add topic tags or summarize conversations before your next report.</p>
            <div className="button-row"><Button className="ghost" disabled={busy || selectedDataset.itemCount === 0} onClick={() => onAnalyze(datasetId, 'tag')}>Add AI tags</Button><Button className="ghost" disabled={busy || selectedDataset.itemCount === 0} onClick={() => onAnalyze(datasetId, 'thread')}>Summarize threads</Button></div>
            <AnalysisList analyses={intelligence} selectedId={selectedAnalysis?.id} onSelect={setSelectedAnalysisId} onRetry={onAnalyze} busy={busy} empty="Tags and thread summaries will appear here." />
          </div>
        </details>
      </div>
      <div className="panel analysis-output report-reader">
        {selectedAnalysis ? <>
          <div className="panel-head">
            <div><span className="data-eyebrow">REPORT VIEWER</span><h3>{selectedAnalysis.reportPresetName || label(selectedAnalysis.kind)}</h3><p>{formatDate(selectedAnalysis.startedAt)} · {label(selectedAnalysis.status)}</p></div>
            <div className="button-row"><Button className="ghost" disabled={!selectedHasFile || busy} onClick={() => onOpenAnalysisOutput(selectedAnalysis.id)}>Open file</Button><Button className="ghost" disabled={!selectedHasFile || busy} onClick={() => onRevealAnalysisOutput(selectedAnalysis.id)}>Show in Finder</Button>{selectedAnalysis.status === 'failed' && <Button disabled={busy || !selectedAnalysis.datasetId} onClick={() => onAnalyze(selectedAnalysis.datasetId, selectedAnalysis.kind, { reportPresetId: selectedAnalysis.reportPresetId })}>Retry</Button>}</div>
          </div>
          {selectedAnalysis.aiReceipt && <div className="report-helper">AI: {selectedAnalysis.aiReceipt.actualModel || selectedAnalysis.aiReceipt.provider} · {selectedAnalysis.coverage?.includedItems ?? '—'} source records included{selectedAnalysis.coverage?.omittedItems ? ` · ${selectedAnalysis.coverage.omittedItems} outside this sample` : ''}</div>}
          <AnalysisOutput output={analysisOutput} />
          {selectedAnalysis.kind === 'report' && onReadResearchReview && <ReportReviewLoader key={selectedAnalysis.id} analysis={selectedAnalysis} dataset={selectedDataset} reviewVersion={state.researchReviews?.find((review) => review.analysisId === selectedAnalysis.id)?.version} onRead={onReadResearchReview} onSave={onSaveResearchReview} onExport={onExportResearchReview} busy={busy} />}
        </> : <div className="report-reader-empty"><span className="data-welcome-icon"><Sparkles size={26} aria-hidden="true" /></span><h3>Turn a collection into a clear next step.</h3><p>Choose a report on the left to uncover patterns, find leads, or understand what people are saying.</p><div className="report-example"><span>YOUR REPORT CAN INCLUDE</span><p>Key findings and recurring themes</p><p>Evidence from the source data</p><p>Practical recommendations</p></div></div>}
      </div>
    </section>
  );
}

function AnalysisList({ analyses, selectedId, onSelect, onRetry, busy, empty }) {
  return <div className="stack">{analyses.map((analysis) => <article className={`analysis-card ${selectedId === analysis.id ? 'active' : ''}`} key={analysis.id}>
    <div className="analysis-head"><Badge tone={statusTone(analysis.status)}>{label(analysis.status)}</Badge><strong>{analysis.reportPresetName || label(analysis.kind)}</strong></div>
    <small>{formatDate(analysis.startedAt)}</small>
    <p>{short(analysis.error || analysis.preview || (analysis.status === 'running' ? 'Analysis is in progress.' : 'Select to read this analysis.'), 160)}</p>
    <div className="button-row"><Button className="ghost" aria-pressed={selectedId === analysis.id} onClick={() => onSelect(analysis.id)}>View</Button>{analysis.status === 'failed' && <Button disabled={busy || !analysis.datasetId} onClick={() => onRetry(analysis.datasetId, analysis.kind, { reportPresetId: analysis.reportPresetId })}>Retry</Button>}</div>
    {(analysis.reportPath || analysis.outputPath) && <details className="analysis-file-details"><summary>File details</summary><code>{analysis.reportPath || analysis.outputPath}</code></details>}
  </article>)}{!analyses.length && <p className="report-history-empty">{empty}</p>}</div>;
}

function AnalysisOutput({ output }) {
  if (!output) return <Empty title="No output selected" detail="Select an analysis to read its results." />;
  if (output.loading) return <Empty title="Loading your report…" detail="Reading the saved analysis." />;
  if (output.error) return <Empty title="Output unavailable" detail={output.error} />;
  const eventLabels = codexEventLabels(output.events || []);
  return <div className="analysis-output-body">
    {output.markdown && <MarkdownContent className="report-markdown">{output.markdown}</MarkdownContent>}
    {output.output && (output.markdown ? <details className="prompt-details"><summary>Structured data</summary><JsonBlock value={output.output} /></details> : <JsonBlock value={output.output} />)}
    {!output.markdown && !output.output && <Empty title="Your analysis is not ready yet" detail="Results will appear here when this run produces its output. Check the run details below for progress." />}
    {(output.context || output.prompt || eventLabels.length > 0 || output.stderr) && <details className="prompt-details analysis-run-details">
      <summary>Run details & technical logs</summary>
      {output.context && <div className="analysis-context"><strong>Run context</strong><div><Badge tone={output.context.profile?.health?.tone || 'neutral'}>{output.context.profile?.health?.label || output.context.run?.kind || 'Context'}</Badge><small>{short(output.context.profile?.summary || output.context.dataset?.name || 'Saved analysis context', 180)}</small></div></div>}
      {output.prompt && <details className="prompt-details"><summary>Prompt and run rules</summary><pre>{output.prompt}</pre></details>}
      {(eventLabels.length > 0 || output.stderr) && <div className="codex-log"><strong>Run log</strong>{eventLabels.map((event, index) => <small key={`${event}-${index}`}>{short(event, 180)}</small>)}{output.stderr && <pre>{output.stderr}</pre>}</div>}
    </details>}
  </div>;
}

function ReportReviewLoader({ analysis, dataset, reviewVersion, onRead, onSave, onExport, busy }) {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const readRef = useRef(onRead);
  readRef.current = onRead;
  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.resolve().then(() => readRef.current(analysis.id)).then((result) => {
      if (!cancelled) setBundle(result);
    }).catch((failure) => { if (!cancelled) setError(failure?.message || 'Could not load source coverage.'); });
    return () => { cancelled = true; };
  }, [analysis.id, analysis.status, analysis.finishedAt, reviewVersion, reload]);
  async function save(payload) {
    const result = await onSave(payload);
    if (result?.review && result?.coverage) setBundle(result);
    return result;
  }
  if (error) return <div className="review-load-state"><p role="alert">Coverage review unavailable: {error}</p><Button className="ghost" onClick={() => setReload((value) => value + 1)}>Reload coverage</Button></div>;
  if (!bundle) return <div className="review-load-state" role="status">Loading saved sources and review…</div>;
  return <CoverageReviewPanel analysis={bundle.analysis || analysis} dataset={bundle.dataset || dataset} reviewBundle={bundle} onSaveReview={onSave ? save : undefined} onExportReview={onExport} busy={busy} />;
}
