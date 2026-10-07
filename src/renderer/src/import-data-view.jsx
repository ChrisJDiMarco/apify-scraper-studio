import React, { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FileUp, FileText, ShieldCheck, Table2 } from 'lucide-react';
import './import-data.css';

const SOURCES = [
  { id: 'customer-feedback', name: 'Customer feedback', description: 'Reviews, interviews, surveys, or support exports.' },
  { id: 'serp', name: 'Search results', description: 'Ranked results with a query, country, and language.' },
  { id: 'ad-library', name: 'Ad research', description: 'Authorized creative and advertiser exports.' },
  { id: 'general', name: 'Other research', description: 'Any structured records you have permission to use.' },
];
const FIELDS = [['text', 'Text', true], ['url', 'Source URL'], ['date', 'Published date'], ['author', 'Author'], ['account', 'Account / brand'], ['query', 'Search query'], ['rank', 'Rank']];
const templateSources = { 'voice-of-customer': 'customer-feedback', 'content-opportunity': 'serp', 'ad-creative-research': 'ad-library' };

export function ImportDataView({ state = {}, busy = false, onPickFile, onPreview, onImport, onNavigate, templateId = '', reportPresetId = '' }) {
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState('csv');
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState(templateSources[templateId] || 'general');
  const [mapping, setMapping] = useState({});
  const [columns, setColumns] = useState([]);
  const [metadata, setMetadata] = useState({ sourceName: '', collectedAt: '', country: '', language: '' });
  const [brandContext, setBrandContext] = useState(() => {
    const profile = (state.brandProfiles || []).find((item) => item.id === state.settings?.selectedBrandProfileId);
    return { brand: profile?.name || '', decision: '', audience: profile?.audience || '' };
  });
  const [authorized, setAuthorized] = useState(false);
  const [preview, setPreview] = useState(null);
  const [saved, setSaved] = useState(null);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const locked = busy || Boolean(working);
  const request = () => ({ name: name.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported research', format, content, mapping, sourceType, authorized, metadata, brandContext, templateId, reportPresetId: reportPresetId || templateId });
  function invalidate(resetColumns = false) { setPreview(null); setError(''); if (resetColumns) { setColumns([]); setMapping({}); } }
  async function run(action, label) {
    if (inFlight.current || locked) return;
    inFlight.current = true; setWorking(label); setError('');
    try { await action(); } catch (failure) { setError(failure?.message || 'This step could not be completed. Your inputs are still here.'); }
    finally { inFlight.current = false; setWorking(''); }
  }
  function pick() {
    run(async () => {
      const file = await onPickFile?.();
      if (!file) return;
      if (typeof file.content !== 'string') throw new Error('This file could not be read. Choose CSV, JSON, or JSONL.');
      setFileName(file.name || 'Research file'); setContent(file.content); invalidate(true);
      const extension = (file.name || '').split('.').at(-1)?.toLowerCase();
      setFormat(extension === 'json' ? 'json' : ['jsonl', 'ndjson'].includes(extension) ? 'jsonl' : 'csv');
      if (!name.trim()) setName((file.name || '').replace(/\.[^.]+$/, ''));
    }, 'file');
  }
  function showPreview() {
    run(async () => {
      const result = await onPreview({ ...request(), preview: true });
      const summary = result?.summary || result;
      if (!summary || !Array.isArray(summary.columns)) throw new Error('Preview was not returned. Please try again.');
      setColumns(summary.columns); setMapping(summary.mapping || {}); setPreview(summary);
    }, 'preview');
  }
  function save() {
    if (!authorized || !preview || preview.ready === false || !preview.importedRows) return;
    run(async () => {
      const result = await onImport({ ...request(), preview: false, authorized: true });
      const dataset = result?.dataset || result;
      if (!dataset?.id) throw new Error('The collection could not be saved. Your preview is still here.');
      setSaved({ dataset, summary: result.summary || preview });
    }, 'import');
  }
  if (saved) return <section className="research-import import-complete"><span className="import-complete-icon"><CheckCircle2 size={30} aria-hidden="true" /></span><span className="research-eyebrow">RESEARCH ADDED</span><h2>Your evidence is ready to explore.</h2><p><strong>{saved.dataset.name}</strong> contains {saved.summary.importedRows} imported record{saved.summary.importedRows === 1 ? '' : 's'}. Your source context and mapping were saved with the collection.</p><div className="research-actions"><button type="button" className="ghost" onClick={() => onNavigate?.('datasets', { datasetId: saved.dataset.id })}>Review dataset<Table2 size={16} aria-hidden="true" /></button><button type="button" onClick={() => onNavigate?.('reports', { datasetId: saved.dataset.id, reportPresetId: reportPresetId || templateId })}>Create research brief<ArrowRight size={16} aria-hidden="true" /></button></div><small>No collection service or AI request was started.</small></section>;

  return <section className="research-import" aria-labelledby="import-title">
    <header className="research-page-heading"><span className="research-eyebrow">BRING YOUR OWN EVIDENCE</span><h2 id="import-title">Put your research to work.</h2><p>Import an export, check the mapping, and turn the records into a useful brief.</p></header>
    <div className="import-layout"><div className="research-card import-setup"><fieldset disabled={locked}>
      <legend className="sr-only">Import setup</legend>
      <label className="research-field">Collection name<input value={name} onChange={(event) => { setName(event.target.value); invalidate(); }} maxLength={160} placeholder="e.g. September customer interviews" /></label>
      <fieldset className="import-source-options"><legend>What kind of evidence is this?</legend>{SOURCES.map((source) => <label key={source.id} className={sourceType === source.id ? 'selected' : ''}><input type="radio" name="import-source-type" value={source.id} checked={sourceType === source.id} onChange={() => { setSourceType(source.id); invalidate(true); }} /><span><strong>{source.name}</strong><small>{source.description}</small></span></label>)}</fieldset>
      <div className="import-file-row"><button type="button" className="ghost" disabled={!onPickFile} onClick={pick}><FileUp size={17} aria-hidden="true" />{working === 'file' ? 'Opening…' : 'Choose a file'}</button><span>{fileName || 'CSV, JSON, or JSONL · up to 5 MB'}</span></div>
      <div className="import-paste-heading"><label htmlFor="import-content">Or paste your records</label><label>Format<select aria-label="Import format" value={format} onChange={(event) => { setFormat(event.target.value); invalidate(true); }}><option value="csv">CSV</option><option value="json">JSON</option><option value="jsonl">JSONL</option></select></label></div>
      <textarea id="import-content" className="import-content" value={content} onChange={(event) => { setContent(event.target.value); setFileName(''); invalidate(true); }} spellCheck="false" rows={7} placeholder={'text,url,author\n"The reporting workflow is too slow",https://example.com/review,Customer'} />
      <small className="research-help">Up to 5,000 records. CSV needs a header row. Search exports with nested organic results are flattened into one record per result.</small>
      <details className="import-context"><summary>Research context <span>Optional, useful for a better brief</span></summary><div className="research-field-grid">
        <label className="research-field">Source name<input value={metadata.sourceName} maxLength={160} onChange={(event) => { setMetadata({ ...metadata, sourceName: event.target.value }); invalidate(); }} placeholder="e.g. Support export" /></label>
        <label className="research-field">Collected on<input type="date" value={metadata.collectedAt} onChange={(event) => { setMetadata({ ...metadata, collectedAt: event.target.value }); invalidate(); }} /></label>
        <label className="research-field">Country<input value={metadata.country} maxLength={100} onChange={(event) => { setMetadata({ ...metadata, country: event.target.value }); invalidate(); }} placeholder="e.g. United States" /></label>
        <label className="research-field">Language<input value={metadata.language} maxLength={100} onChange={(event) => { setMetadata({ ...metadata, language: event.target.value }); invalidate(); }} placeholder="e.g. English" /></label>
        <label className="research-field">Brand or project<input value={brandContext.brand} maxLength={120} onChange={(event) => { setBrandContext({ ...brandContext, brand: event.target.value }); invalidate(); }} /></label>
        <label className="research-field">Audience<input value={brandContext.audience} maxLength={300} onChange={(event) => { setBrandContext({ ...brandContext, audience: event.target.value }); invalidate(); }} /></label>
        <label className="research-field wide">Decision to support<textarea rows={2} value={brandContext.decision} maxLength={2000} onChange={(event) => { setBrandContext({ ...brandContext, decision: event.target.value }); invalidate(); }} placeholder="What do you want to decide from these records?" /></label>
      </div></details>
      {columns.length > 0 && <section className="import-mapping" aria-labelledby="mapping-title"><h3 id="mapping-title">Match your columns</h3><p>Text is required. Leave fields unmapped when the export does not contain them.</p><div className="research-field-grid">{FIELDS.map(([field, label, required]) => <label className="research-field" key={field}>{label}{required && <span className="import-required">Required</span>}<select aria-label={`Map ${label}`} value={mapping[field] || ''} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value }); invalidate(); }}><option value="">Not mapped</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}</div></section>}
      <div className="research-actions"><button type="button" disabled={!content.trim() || !onPreview} onClick={showPreview}><Table2 size={16} aria-hidden="true" />{working === 'preview' ? 'Reading records…' : columns.length ? 'Preview mapped records' : 'Preview records'}</button><small>Local preview · no AI request</small></div>
    </fieldset></div>
    <aside className="import-aside"><div className="research-card import-review"><span className="import-review-icon"><FileText size={21} aria-hidden="true" /></span><h3>Review before adding.</h3><p>Your import becomes a source collection. Mapping keeps the text, links, and context useful in later analysis.</p><ul><li>Check the first 20 records below.</li><li>Exact duplicates are excluded.</li><li>Source dates stay separate from import time.</li></ul><label className="import-authorization"><input type="checkbox" checked={authorized} disabled={locked} onChange={(event) => setAuthorized(event.target.checked)} /><span>I have permission to use and import this data.</span></label><button type="button" disabled={locked || !authorized || !preview?.importedRows || preview?.ready === false || !onImport} onClick={save}>{working === 'import' ? 'Adding collection…' : 'Add to research'}<ArrowRight size={16} aria-hidden="true" /></button><small><ShieldCheck size={13} aria-hidden="true" />Stored on this Mac. AI receives evidence only when you later request an analysis.</small></div></aside></div>
    {error && <div className="research-error" role="alert">{error}</div>}
    {preview && <section className="research-card import-preview" aria-labelledby="preview-title"><div className="import-preview-heading"><div><span className="research-eyebrow">MAPPED PREVIEW</span><h3 id="preview-title">{preview.importedRows} record{preview.importedRows === 1 ? '' : 's'} ready</h3></div><span>{preview.inputRows} source row{preview.inputRows === 1 ? '' : 's'} · {preview.duplicateRows || 0} duplicate{preview.duplicateRows === 1 ? '' : 's'} excluded</span></div>{preview.warnings?.length > 0 && <ul className="research-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}{preview.preview?.length > 0 && <><div className="import-table-scroll"><table><thead><tr><th scope="col">Text</th><th scope="col">Source URL</th><th scope="col">Author / account</th><th scope="col">Query / rank</th></tr></thead><tbody>{preview.preview.slice(0, 20).map((item, index) => <tr key={item.id || index}><td>{String(item.text || '').slice(0, 360)}</td><td>{item.url || 'No link'}</td><td>{[item.author, item.account].filter(Boolean).join(' · ') || '—'}</td><td>{[item.query, item.rank != null ? `#${item.rank}` : ''].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div><small>Showing {Math.min(20, preview.preview.length)} of {preview.importedRows} record{preview.importedRows === 1 ? '' : 's'}. Full text is retained in the saved collection.</small></>}</section>}
  </section>;
}
