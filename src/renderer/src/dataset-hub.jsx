import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Copy, Database, ExternalLink, Eye, Heart, MessageCircle, Repeat2, Search, Upload, ChevronDown, Sparkles } from 'lucide-react';
import { buildCoverage, buildSignals, buildTopics, coverageChecks, authorName } from '../../shared/dataset-insights.js';
import { Button, datasetLabel, formatDate, label, number, withViewTransition } from './ui.jsx';
import './workspace-pages.css';

export const DATASET_TABS = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'signals', label: 'Signals' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'topics', label: 'Topics' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'reports', label: 'Reports' },
  { id: 'compare', label: 'Compare' },
];
const PAGE = 40;
const PLATFORM_NAMES = { x: 'X', twitter: 'X', linkedin: 'LinkedIn', reddit: 'Reddit', web: 'Web', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
export const platformName = (value) => PLATFORM_NAMES[value] || label(value || 'unknown');
const percent = (value) => `${Math.round(value * 100)}%`;

function Stat({ label: name, value, detail }) {
  return <div className="ws-stat"><span>{name}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function DatasetHub({ state, tab, onTabChange, selectedDataset, payload, payloadError = '', onDatasetSelect, onNavigate, pageAllowed, onOpenSourceUrl, onAsk, renderExplorer, renderConversations, renderReports, renderCompare }) {
  const [signalQuery, setSignalQuery] = useState('');
  const items = payload?.items || [];
  const datasets = state.datasets || [];
  const loading = Boolean(selectedDataset) && !payload && !payloadError;
  const setTab = (next) => withViewTransition(() => onTabChange(next), ['trend-move']);
  const tabs = DATASET_TABS.filter(({ id }) => id === 'explorer' || (['reports', 'compare'].includes(id) ? pageAllowed(id) : datasets.length > 0));
  const shown = tabs.some((item) => item.id === tab) ? tab : 'explorer';
  return <section className="ws ws-datasets">
    <header className="ws-page-head">
      <div><h2>Research data</h2><p>Collect, explore, and compare the source data behind your research.</p></div>
      <div className="ws-head-actions">
        {datasets.length > 0 && !['explorer', 'reports', 'compare'].includes(shown) && <label className="ws-select"><span className="sr-only">Dataset</span><select aria-label="Dataset" value={selectedDataset?.id || ''} onChange={(event) => onDatasetSelect(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{datasetLabel(dataset, { rows: true })}</option>)}</select></label>}
        {onAsk && datasets.length > 0 && !['compare', 'reports'].includes(shown) && <Button className="ghost" onClick={() => onAsk(selectedDataset?.id)}><Sparkles size={15} aria-hidden="true" />Ask AI about data</Button>}
        {(pageAllowed('search') || pageAllowed('automation')) && <details className="ws-collect"><summary className="ghost">Collect data <ChevronDown size={14} aria-hidden="true" /></summary><div>{pageAllowed('search') && <button type="button" onClick={() => onNavigate('search')}>Search platforms</button>}{pageAllowed('automation') && <button type="button" onClick={() => onNavigate('automation')}>Saved scrapers</button>}</div></details>}
        {pageAllowed('imports') && <Button className="ghost" onClick={() => onNavigate('imports')}><Upload size={15} aria-hidden="true" />Import</Button>}
        {shown === 'reports' && pageAllowed('templates') && <Button className="ghost" onClick={() => onNavigate('templates')}>Brief starters</Button>}
      </div>
    </header>
    <div className="ws-tabs" role="tablist" aria-label="Dataset views">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" id={`ds-tab-${item.id}`} aria-selected={shown === item.id} aria-controls={`ds-panel-${item.id}`} className={shown === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{item.id === 'signals' && items.length > 0 && <span className="ws-tab-count">{number(items.length)}</span>}</button>)}
    </div>
    <div role="tabpanel" id={`ds-panel-${shown}`} aria-labelledby={`ds-tab-${shown}`} className="ws-tab-panel">
      {shown === 'explorer' && renderExplorer()}
      {shown === 'reports' && renderReports?.()}
      {shown === 'compare' && renderCompare?.()}
      {!['explorer', 'reports', 'compare'].includes(shown) && loading && <div className="ws-skeleton-list" aria-busy="true" aria-label="Loading dataset">{[0, 1, 2].map((i) => <div key={i} className="ws-skeleton" />)}</div>}
      {!['explorer', 'reports', 'compare'].includes(shown) && payloadError && <div className="ws-callout attention" role="alert">This dataset didn’t open: {payloadError}</div>}
      {shown === 'signals' && !loading && !payloadError && <SignalsTab key={selectedDataset?.id} items={items} initialQuery={signalQuery} onOpenSourceUrl={onOpenSourceUrl} />}
      {shown === 'conversations' && !loading && !payloadError && renderConversations()}
      {shown === 'topics' && !loading && !payloadError && <TopicsTab key={selectedDataset?.id} items={items} onSearchSignals={(term) => { setSignalQuery(term); setTab('signals'); }} />}
      {shown === 'coverage' && !loading && !payloadError && <CoverageTab items={items} dataset={selectedDataset} datasets={datasets} onDatasetSelect={onDatasetSelect} onNavigate={onNavigate} />}
    </div>
  </section>;
}

function SignalCard({ row, onOpenSourceUrl }) {
  const { item, score } = row;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = String(item?.text || '').trim();
  const long = text.length > 320;
  const m = item?.metrics || {};
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked; leave state unchanged */ }
  }
  return <article className="ws-signal">
    <header><span className="ws-chip">{platformName(item?.platform)}</span><span className="ws-signal-type">{label(item?.type || 'post')}</span>{authorName(item?.author) && <strong>{authorName(item.author)}</strong>}{item?.publishedAt && <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>}</header>
    <p className={long && !expanded ? 'clamped' : ''}>{text || <em>No text in this row.</em>}</p>
    {long && <button type="button" className="ws-text-button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? 'Show less' : 'Show more'}</button>}
    <footer>
      <span className="ws-metrics" aria-label={`${number(m.likes)} likes, ${number(m.comments)} comments, ${number(m.shares)} shares, ${number(m.views)} views`}><span><Heart size={13} aria-hidden="true" />{number(m.likes)}</span><span><MessageCircle size={13} aria-hidden="true" />{number(m.comments)}</span><span><Repeat2 size={13} aria-hidden="true" />{number(m.shares)}</span>{Number(m.views) > 0 && <span><Eye size={13} aria-hidden="true" />{number(m.views)}</span>}</span>
      <span className="ws-signal-actions">
        {text && <button type="button" className="ws-icon-action" onClick={copy} aria-label={copied ? 'Copied' : 'Copy text'} title={copied ? 'Copied' : 'Copy text'}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>}
        {item?.url && onOpenSourceUrl && <button type="button" className="ws-icon-action" onClick={() => onOpenSourceUrl(item.url)} aria-label="Open source" title="Open source"><ExternalLink size={14} aria-hidden="true" /></button>}
      </span>
    </footer>
    {score > 0 && <span className="sr-only">Engagement score {score}</span>}
  </article>;
}

export function SignalsTab({ items, initialQuery = '', onOpenSourceUrl }) {
  const [query, setQuery] = useState(initialQuery);
  const [platform, setPlatform] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('engagement');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => { setShown(PAGE); }, [query, platform, type, sort]);
  const { rows, facets } = useMemo(() => buildSignals(items, { query, platform, type, sort }), [items, query, platform, type, sort]);
  if (!items.length) return <div className="ws-empty"><Database size={22} aria-hidden="true" /><h3>No rows to read yet</h3><p>This dataset is empty. Run its scraper again or import data to see signals here.</p></div>;
  const filtered = query || platform !== 'all' || type !== 'all';
  return <div className="ws-stack">
    <div className="ws-toolbar">
      <label className="ws-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search signals" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text, authors, links…" /></label>
      <div className="ws-segmented" role="group" aria-label="Platform">
        <button type="button" aria-pressed={platform === 'all'} onClick={() => setPlatform('all')}>All <span>{number(items.length)}</span></button>
        {facets.platforms.map((facet) => <button key={facet.value} type="button" aria-pressed={platform === facet.value} onClick={() => setPlatform(facet.value)}>{platformName(facet.value)} <span>{number(facet.total)}</span></button>)}
      </div>
      {facets.types.length > 1 && <select aria-label="Type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{facets.types.map((facet) => <option key={facet.value} value={facet.value}>{label(facet.value)} ({number(facet.total)})</option>)}</select>}
      <select aria-label="Sort signals" value={sort} onChange={(event) => setSort(event.target.value)}><option value="engagement">Most engagement</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
    </div>
    <p className="ws-result-line" role="status">{rows.length === items.length ? `${number(rows.length)} signals` : `${number(rows.length)} of ${number(items.length)} signals`}{filtered && <button type="button" className="ws-text-button" onClick={() => { setQuery(''); setPlatform('all'); setType('all'); }}>Clear filters</button>}</p>
    {rows.length ? <div className="ws-signal-grid">{rows.slice(0, shown).map((row) => <SignalCard key={`${row.index}-${row.item?.id || ''}`} row={row} onOpenSourceUrl={onOpenSourceUrl} />)}</div>
      : <div className="ws-empty"><Search size={22} aria-hidden="true" /><h3>Nothing matches</h3><p>Try a broader search or another platform.</p></div>}
    {rows.length > shown && <Button className="ghost ws-more" onClick={() => setShown((count) => count + PAGE)}>Show {number(Math.min(PAGE, rows.length - shown))} more</Button>}
  </div>;
}

export function TopicsTab({ items, onSearchSignals }) {
  const [mode, setMode] = useState('phrases');
  const [open, setOpen] = useState('');
  const { topics, total } = useMemo(() => buildTopics(items, { mode, limit: 20 }), [items, mode]);
  if (!items.length) return <div className="ws-empty"><Database size={22} aria-hidden="true" /><h3>No text to read</h3><p>Topics appear once this dataset has rows with text.</p></div>;
  const top = topics[0]?.total || 1;
  return <div className="ws-stack">
    <div className="ws-toolbar">
      <div className="ws-segmented" role="group" aria-label="Topic type"><button type="button" aria-pressed={mode === 'phrases'} onClick={() => { setMode('phrases'); setOpen(''); }}>Phrases</button><button type="button" aria-pressed={mode === 'words'} onClick={() => { setMode('words'); setOpen(''); }}>Single words</button></div>
      <p className="ws-hint">Ranked by how many of the {number(total)} rows mention each {mode === 'phrases' ? 'phrase' : 'word'}. Counted on this device; for AI themes, use Research programs.</p>
    </div>
    {topics.length ? <ol className="ws-topic-list">{topics.map((topic, index) => <li key={topic.term} className={open === topic.term ? 'open' : ''}>
      <button type="button" className="ws-topic-row" aria-expanded={open === topic.term} onClick={() => setOpen((current) => current === topic.term ? '' : topic.term)}>
        <span className="ws-rank">{index + 1}</span><strong>{topic.term}</strong>
        <span className="ws-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (topic.total / top) * 100)}%` }} /></span>
        <span className="ws-topic-count">{number(topic.total)} rows · {percent(topic.share)}</span>
      </button>
      {open === topic.term && <div className="ws-topic-detail">{topic.examples.map((example, i) => <blockquote key={i}>{String(example?.text || '').slice(0, 280)}{String(example?.text || '').length > 280 ? '…' : ''}<cite>{[platformName(example?.platform), authorName(example?.author)].filter(Boolean).join(' · ')}</cite></blockquote>)}<Button className="ghost" onClick={() => onSearchSignals(topic.term)}>See every mention in Signals<ArrowRight size={14} aria-hidden="true" /></Button></div>}
    </li>)}</ol> : <div className="ws-empty"><Search size={22} aria-hidden="true" /><h3>No repeated {mode === 'phrases' ? 'phrases' : 'words'} yet</h3><p>{mode === 'phrases' ? 'Try single words, or collect more rows so phrases repeat.' : 'Collect more rows so words repeat across posts.'}</p></div>}
  </div>;
}

export function CoverageTab({ items, dataset, datasets, onDatasetSelect, onNavigate }) {
  const coverage = useMemo(() => buildCoverage(items), [items]);
  const checks = coverageChecks(coverage);
  const range = coverage.earliest ? `${new Date(coverage.earliest).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(coverage.latest).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No dates';
  const top = coverage.platforms[0]?.total || 1;
  return <div className="ws-stack">
    <div className="ws-stat-row">
      <Stat label="Rows" value={number(coverage.total)} detail={dataset ? platformName(dataset.platform) : ''} />
      <Stat label="Authors" value={number(coverage.authors)} detail={coverage.topAuthor ? `Top: ${coverage.topAuthor}` : ''} />
      <Stat label="Date range" value={range} detail={coverage.total ? `${percent(coverage.dated / coverage.total)} dated` : ''} />
      <Stat label="Source links" value={coverage.total ? percent(coverage.withUrl / coverage.total) : '—'} detail="Rows you can verify" />
      <Stat label="Engagement" value={number(coverage.engagement.likes + coverage.engagement.comments + coverage.engagement.shares)} detail={`${number(coverage.engagement.comments)} comments`} />
    </div>
    <div className="ws-two-col">
      <section className="ws-card"><h3>Before you trust a finding</h3><ul className="ws-checks">{checks.map((check) => <li key={check.text} className={check.tone}>{check.tone === 'ready' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}<span>{check.text}</span></li>)}</ul>{!checks.length && <p className="ws-hint">Collect rows to see data-quality checks.</p>}</section>
      <section className="ws-card"><h3>Where it comes from</h3>{coverage.platforms.length ? <ul className="ws-bars">{coverage.platforms.map((row) => <li key={row.value}><span>{platformName(row.value)}</span><span className="ws-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (row.total / top) * 100)}%` }} /></span><strong>{number(row.total)}</strong></li>)}</ul> : <p className="ws-hint">No rows yet.</p>}</section>
    </div>
    <section className="ws-card"><div className="ws-card-head"><h3>All datasets</h3><Button className="ghost" onClick={() => onNavigate('automation')}>Collect more<ArrowRight size={14} aria-hidden="true" /></Button></div>
      <div className="table-wrap"><table><thead><tr><th>Dataset</th><th>Source</th><th>Rows</th><th>Collected</th></tr></thead><tbody>{datasets.map((row) => <tr key={row.id} className={row.id === dataset?.id ? 'active-row' : ''} tabIndex={0} aria-selected={row.id === dataset?.id} onClick={() => onDatasetSelect(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDatasetSelect(row.id); } }}><td>{row.name}</td><td>{platformName(row.platform)}</td><td>{number(row.itemCount)}</td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
