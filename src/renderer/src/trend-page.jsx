// A trend's one page: what it is, where it stands and its one next step in the header, then tabs for the overview, the
// trends report, the editorial toolkit and the channel assets made from them. The page is laid out here; the documents
// and the assets are the same reader (simple-reports.jsx) and folder view (simple-assets.jsx) as before, embedded, so
// nothing about reading, editing or making assets changes. simple-mode.jsx owns the data and what each step does.
//
// card      the board card shown (src/shared/trend-board.js); `runs` are this theme's cards in every research run
// stage     stageOf(card, { can }) (trend-stage.js): the chip, the line under it and the next step
// tab       'overview' | 'report' | 'toolkit' | 'assets'; a tab with nothing to show yet is disabled and says why
// onNext(next), onSkip()  the header's buttons; `yes` replaces the Approve button with Trends' own (Yes, with a note…)
// why, decided            the "why it matters" block and who decided it, as Trends shows them
// uses      channels using this trend ({ channelId, name, link, byName }), from the channel owners' answers
// renderDoc(assetId), renderAssets(reportAssetId)  the embedded reader and folder view
import { ArrowLeft, ExternalLink, FileText, Images, Link2, LoaderCircle, Megaphone, TriangleAlert } from 'lucide-react';
import { writeProps } from './viewer.js';
import { formatDate, number } from './ui.jsx';

const list = (value) => (Array.isArray(value) ? value : []);
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;
const PLATFORM = { x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
const readable = (value) => String(value || '').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
export const TREND_PAGE_TABS = Object.freeze([['overview', 'Overview'], ['report', 'Trends report'], ['toolkit', 'Editorial toolkit'], ['assets', 'Channel assets']]);

// The document a tab reads: the trends report, or the editorial toolkit.
export const docOf = (card, tab) => list(card?.reportAssets).find((asset) => asset.deliverableId === (tab === 'toolkit' ? 'editorial-toolkit' : 'evidence-report')) || null;
// The tab a document opens on.
export const tabOfDoc = (asset) => (asset?.deliverableId === 'editorial-toolkit' ? 'toolkit' : 'report');
// Why a tab has nothing yet, '' when it can be opened.
export function tabBlocked(card, tab) {
  if (tab === 'overview') return '';
  const waiting = card.stage === 'potential' || card.stage === 'approved' ? 'Reports are written after a trend is approved.' : card.stage === 'passed' ? 'This trend was skipped, so no reports were written.' : 'The reports are still being written.';
  if (tab === 'assets') return list(card.reportAssets).length ? '' : waiting;
  return docOf(card, tab) ? '' : waiting;
}

export function StageChip({ stage }) {
  if (!stage) return null;
  return <span className="stage-chip" data-tone={stage.tone}>{stage.tone === 'working' && <LoaderCircle className="spin" size={12} aria-hidden="true" />}{stage.tone === 'attention' && <TriangleAlert size={12} aria-hidden="true" />}{stage.label}</span>;
}

export function TrendPage({ card, runs = [], stage, tab = 'overview', onTab, onRun, onBack, backLabel = 'Trends', busy = false, viewer = {}, momentum = null, yes = null, onNext, onSkip, why = null, decided = null, uses = [], onCopyLink, api = {}, renderDoc, renderAssets }) {
  const shown = tabBlocked(card, tab) ? 'overview' : tab;
  const report = docOf(card, 'report'); const toolkit = docOf(card, 'toolkit');
  const next = stage?.next || null;
  const facts = [
    ['Research program', card.programName],
    ['Found', card.discoveredAt ? formatDate(card.discoveredAt) : ''],
    ['Sources', card.evidenceCount ? plural(card.evidenceCount, 'post') : ''],
    ['Platforms', list(card.platforms).map((platform) => PLATFORM[platform] || platform).join(', ')],
    ['Category', card.category ? readable(String(card.category).toLowerCase()) : ''],
    ['Seen in', card.detectionCount > 1 ? plural(card.detectionCount, 'research run') : ''],
    ['Keywords', list(card.keywords).join(', ')],
  ].filter(([, value]) => value);
  const otherRuns = list(runs).filter((row) => row.runId !== card.runId);
  return <div className="simple-page trend-page" data-stage={stage?.id}>
    <header className="trend-page-head">
      <div className="trend-page-top">
        <button type="button" className="simple-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />{backLabel}</button>
        {otherRuns.length > 0 && <label className="trend-page-run"><span>Research run</span><select aria-label="Research run" value={card.runId} onChange={(event) => onRun?.(event.target.value)}>{list(runs).map((row) => <option key={row.runId} value={row.runId}>{[row.discoveredAt ? formatDate(row.discoveredAt) : 'Undated', row.programName].filter(Boolean).join(' · ')}</option>)}</select></label>}
      </div>
      <div className="trend-page-title">
        <div>
          <div className="simple-trend-meta">
            <StageChip stage={stage} />
            {card.priorityTier && <span className={`simple-tier tier-${card.priorityTier.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{readable(card.priorityTier.toLowerCase())}</span>}
            {momentum}
            <span>{plural(card.evidenceCount, 'source')}</span>
            {list(card.platforms).length > 0 && <span>{card.platforms.map((platform) => PLATFORM[platform] || platform).join(' · ')}</span>}
            {card.programName && <span className="simple-trend-program" title={`From the research program “${card.programName}”`}>{card.programName}</span>}
          </div>
          <h1>{card.name}</h1>
          {stage?.detail && <p className="trend-page-detail">{stage.detail}</p>}
        </div>
        <div className="simple-head-actions trend-page-actions">
          {onCopyLink && <button type="button" className="simple-quiet" onClick={onCopyLink}><Link2 size={15} aria-hidden="true" />Copy link</button>}
          {next?.id === 'decide' && onSkip && <button type="button" className="simple-skip" aria-label={`Skip ${card.name}`} {...writeProps(viewer, busy)} onClick={onSkip}>Skip</button>}
          {next?.id === 'decide' && yes ? yes
            : next && onNext ? <button type="button" className={next.id === 'restore' || next.id === 'open-assets' ? 'simple-quiet' : 'simple-primary'} data-spot="trend.next" {...(next.id === 'open-assets' ? { disabled: false } : writeProps(viewer, busy))} onClick={() => onNext(next)}>{next.label}</button> : null}
        </div>
      </div>
      <div className="simple-segment trend-page-tabs" role="tablist" aria-label="This trend">
        {TREND_PAGE_TABS.map(([id, label]) => { const blocked = tabBlocked(card, id); return <button type="button" role="tab" key={id} id={`trend-tab-${id}`} aria-selected={shown === id} aria-controls="trend-panel" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => onTab?.(id)}>{label}{id === 'assets' && Number(card.assetCount) > 0 && <span className="trend-tab-count">{number(card.assetCount)}</span>}</button>; })}
      </div>
    </header>

    <div id="trend-panel" role="tabpanel" aria-labelledby={`trend-tab-${shown}`} className="trend-page-panel">
      {shown === 'overview' && <div className="trend-overview">
        <div className="trend-overview-main">
          {card.description && <p className="trend-overview-summary">{card.description}</p>}
          {why}
          {decided}
          <section aria-labelledby="trend-docs-title">
            <h2 id="trend-docs-title">Documents</h2>
            {report || toolkit ? <div className="simple-report-list">
              {[[report, 'report', 'Trends report', 'What people are saying, with the evidence.'], [toolkit, 'toolkit', 'Editorial toolkit', 'Angles, headlines and briefs for writers.']].filter(([asset]) => asset).map(([asset, id, label, hint]) => <button type="button" key={asset.id} onClick={() => onTab?.(id)}><span className="simple-doc-icon"><FileText size={18} aria-hidden="true" /></span><span><strong>{label}</strong><small>{hint}</small></span></button>)}
              <button type="button" onClick={() => onTab?.('assets')}><span className="simple-doc-icon"><Images size={18} aria-hidden="true" /></span><span><strong>Channel assets</strong><small>{Number(card.assetCount) > 0 ? `${plural(card.assetCount, 'file')} made from the report.` : 'None made yet.'}</small></span></button>
            </div> : <p className="trend-overview-none">{tabBlocked(card, 'report')}</p>}
          </section>
          <section aria-labelledby="trend-uses-title">
            <h2 id="trend-uses-title">Channels using it</h2>
            {uses.length ? <ul className="trend-uses">{uses.map((use) => <li key={use.channelId}><span><Megaphone size={15} aria-hidden="true" />{use.name}</span>
              {use.link ? <a href={use.link} target="_blank" rel="noreferrer" onClick={(event) => { if (api.openSourceUrl) { event.preventDefault(); api.openSourceUrl(use.link); } }}>Open link<ExternalLink size={13} aria-hidden="true" /></a> : <small>No link yet</small>}</li>)}</ul>
              : <p className="trend-overview-none">No channel has said it’s using this trend yet.</p>}
          </section>
        </div>
        {facts.length > 0 && <aside className="trend-facts" aria-label="About this trend"><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></aside>}
      </div>}
      {(shown === 'report' || shown === 'toolkit') && renderDoc?.(docOf(card, shown).id)}
      {shown === 'assets' && renderAssets?.((report || toolkit).id)}
    </div>
  </div>;
}
