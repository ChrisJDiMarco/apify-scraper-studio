import React, { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, ExternalLink, MessageSquareQuote, Minus, Search, Send, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { number } from './ui.jsx';
import './trend-pulse.css';
import './trend-board.css';

// Trend momentum in one vocabulary for both layouts. It comes from main's trend history (shared/trend-history.js):
// a trend's share of the posts a run kept, compared with its previous run. Directional, never a forecast.
export const MOMENTUM_COPY = {
  new: { label: 'New', icon: Sparkles, hint: 'First found in the latest research run' },
  rising: { label: 'Rising', icon: TrendingUp, hint: 'Its share of posts grew since its previous run' },
  steady: { label: 'Steady', icon: Minus, hint: 'Its share of posts held about level' },
  fading: { label: 'Fading', icon: TrendingDown, hint: 'Its share of posts fell, or recent runs didn’t find it' },
};

// "2026-10-14" → "Oct 14", read as a local calendar day so it never slips a day west of UTC.
export function dayLabel(value) {
  const day = String(value || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T12:00:00`); return Number.isFinite(date.getTime()) ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
}
const points = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} pts`;

export function MomentumBadge({ momentum, className = '' }) {
  const copy = MOMENTUM_COPY[momentum]; if (!copy) return null;
  const Icon = copy.icon;
  return <span className={`tp-badge ${className}`.trim()} data-momentum={momentum} title={copy.hint}><Icon size={12} strokeWidth={2.2} aria-hidden="true" />{copy.label}</span>;
}

// Posts per run, oldest to newest. The label is the text summary screen readers get.
export function Sparkline({ points: values, label = '', width = 72, height = 22, className = '' }) {
  const list = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!list.length) return null;
  const pad = 2.5; const max = Math.max(...list); const min = Math.min(0, ...list); const span = max - min || 1;
  const x = (index) => (list.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (list.length - 1));
  const y = (value) => height - pad - ((value - min) / span) * (height - pad * 2);
  const line = list.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const area = list.length > 1 ? `${line} L${x(list.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z` : '';
  const summary = label || `Posts per run, oldest to newest: ${list.map((value) => number(value)).join(', ')}`;
  return <svg className={`tp-spark ${className}`.trim()} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} focusable="false">
    {area && <path className="tp-spark-area" d={area} />}
    {list.length > 1 && <path className="tp-spark-line" d={line} />}
    <circle className="tp-spark-dot" cx={x(list.length - 1).toFixed(1)} cy={y(list.at(-1)).toFixed(1)} r="2.4" />
  </svg>;
}

function changeDetail(kind, entry) {
  if (kind === 'fading') return entry.missedRuns >= 2 ? `Not found in the last ${number(entry.missedRuns)} runs` : Number.isFinite(entry.changePp) ? `${points(entry.changePp)} share of posts` : 'Smaller share of posts';
  if (kind === 'rising') return Number.isFinite(entry.changePp) ? `${points(entry.changePp)} share · seen in ${number(entry.runsSeen)} runs` : `Seen in ${number(entry.runsSeen)} runs in a row`;
  return Number.isFinite(entry.latestSharePct) ? `${entry.latestSharePct.toFixed(1)}% of posts · ${number(entry.latestPosts)} posts` : `${number(entry.latestPosts)} posts`;
}

function ChangeList({ kind, entries = [], total = 0, limit, onOpenTrend, onMore }) {
  const headingId = useId(); const shown = entries.slice(0, limit); const more = Math.max(0, total - shown.length);
  return <section className="tp-list" data-momentum={kind} aria-labelledby={headingId}>
    <h4 id={headingId}><MomentumBadge momentum={kind} /><span className="tp-list-count">{number(total)}</span><span className="tp-visually-hidden">{total === 1 ? ' trend' : ' trends'}</span></h4>
    {shown.length ? <ul>{shown.map((entry) => {
      const body = <><span className="tp-item-name" title={entry.name}>{entry.name}</span><span className="tp-item-detail">{changeDetail(kind, entry)}</span></>;
      return <li key={entry.trendId}>{onOpenTrend ? <button type="button" className="tp-item" onClick={() => onOpenTrend(entry)}>{body}</button> : <div className="tp-item">{body}</div>}</li>;
    })}</ul> : <p className="tp-list-empty">{kind === 'new' ? 'No new trends this run.' : kind === 'rising' ? 'Nothing grew its share this run.' : 'Nothing is fading.'}</p>}
    {more > 0 && (onMore ? <button type="button" className="tp-more" onClick={onMore}>{`+${number(more)} more in the Trend tracker`}</button> : <p className="tp-more-text">{`+${number(more)} more`}</p>)}
  </section>;
}

// Home's "What changed" card: changes = readTrendHistory().changes. Undefined or null while it loads.
export function WhatChanged({ changes, onOpenTrend, onOpenTracker, onStartResearch, error = '', limit = 4 }) {
  const headingId = useId();
  const head = (subtitle) => <header className="tp-card-head"><span className="tp-card-icon" aria-hidden="true"><TrendingUp size={17} /></span><div><h3 id={headingId}>What changed</h3>{subtitle && <p>{subtitle}</p>}</div></header>;
  const trackerButton = onOpenTracker && <button type="button" className="tp-link" onClick={onOpenTracker}>Open the Trend tracker<ArrowUpRight size={14} aria-hidden="true" /></button>;
  if (error) return <article className="tp-card" aria-labelledby={headingId}>{head('')}<p className="tp-problem" role="alert">{error}</p></article>;
  if (!changes) return <article className="tp-card" aria-labelledby={headingId} aria-busy="true">{head('Comparing your research runs…')}<div className="tp-skeleton" aria-hidden="true"><span /><span /><span /></div></article>;
  const since = changes.sinceRun;
  if (!since) {
    return <article className="tp-card tp-card-empty" aria-labelledby={headingId}>{head('')}
      <p className="tp-explain">Once a research run finds trends, this card compares each run with the one before it: which trends are new, which are rising and which are fading.</p>
      {onStartResearch && <div className="tp-card-foot"><button type="button" className="tp-link" onClick={onStartResearch}><Search size={14} aria-hidden="true" />Start research</button></div>}
    </article>;
  }
  if (!changes.comparable) {
    const found = Number(changes.counts?.new) || 0;
    return <article className="tp-card tp-card-empty" aria-labelledby={headingId}>{head(`Your first research run (${dayLabel(since.date) || 'latest'})`)}
      <p className="tp-explain">{found ? `It found ${number(found)} ${found === 1 ? 'trend' : 'trends'}. ` : ''}After your next research run, this card shows which trends are new, which grew their share of posts and which are fading, compared with this one.</p>
      {trackerButton && <div className="tp-card-foot">{trackerButton}</div>}
    </article>;
  }
  const counts = changes.counts || {}; const quiet = !counts.new && !counts.rising && !counts.fading;
  return <article className="tp-card" aria-labelledby={headingId}>
    {head(`Since your last research run (${dayLabel(since.date) || since.title})${changes.previousRun?.date ? ` · compared with ${dayLabel(changes.previousRun.date)}` : ''}`)}
    {quiet ? <p className="tp-explain">No trend changed direction: every trend held a steady share of posts.</p>
      : <div className="tp-lists">
        <ChangeList kind="new" entries={changes.newTrends} total={counts.new || 0} limit={limit} onOpenTrend={onOpenTrend} onMore={onOpenTracker} />
        <ChangeList kind="rising" entries={changes.rising} total={counts.rising || 0} limit={limit} onOpenTrend={onOpenTrend} onMore={onOpenTracker} />
        <ChangeList kind="fading" entries={changes.fading} total={counts.fading || 0} limit={limit} onOpenTrend={onOpenTrend} onMore={onOpenTracker} />
      </div>}
    <div className="tp-card-foot"><p className="tp-footnote">Momentum compares each trend’s share of posts with its previous run. It is directional: runs differ in sources and windows.</p>{trackerButton}</div>
  </article>;
}

// ---------- Who decided, and why a trend matters (Simple cards, the Trend board, the channel brief, the briefing) ----------

// The decision a research run recorded for a board card (run.decisionsBy[themeId]): { id, name, at, note?, channels? }.
export function decisionOf(researchRuns, card) {
  const run = (Array.isArray(researchRuns) ? researchRuns : []).find((row) => row?.id === card?.runId);
  return run?.decisionsBy?.[card?.themeId] || null;
}
const shortDate = (value) => { const date = new Date(value || ''); return Number.isFinite(date.getTime()) ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; };
// "Approved by Riley · Oct 14", "Skipped by Sam · Oct 14", "Approved automatically" ('' without a recorded decision).
export function decidedLine(by, decision = 'approved') {
  if (!by || !['approved', 'passed'].includes(decision)) return '';
  const verb = decision === 'passed' ? 'Skipped' : 'Approved';
  if (by.id === 'system' || by.auto) return `${verb} automatically${by.at ? ` · ${shortDate(by.at)}` : ''}`;
  return [`${verb}${by.name ? ` by ${by.name}` : ''}`, shortDate(by.at)].filter(Boolean).join(' · ');
}
// `channelName(id)` names a routed channel; without routing the yes was for every channel.
export function DecidedBy({ by, decision = 'approved', channelName = (id) => id, className = '' }) {
  const line = decidedLine(by, decision); if (!line) return null;
  const routed = (Array.isArray(by.channels) ? by.channels : []).map(channelName).filter(Boolean);
  return <div className={`tp-decided ${className}`.trim()}>
    <p className="tp-decided-line">{decision === 'passed' ? <X size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}<span>{line}</span>{routed.length > 0 && <span className="tp-decided-for"><Send size={11} aria-hidden="true" />For {routed.join(', ')}</span>}</p>
    {by.note && <p className="tp-decided-note"><MessageSquareQuote size={12} aria-hidden="true" /><span>“{by.note}”</span></p>}
  </div>;
}

export const NOVELTY_LABEL = { 'NEW TOPIC': 'New topic', 'NEW ANGLE': 'New angle', EVERGREEN: 'Evergreen' };

// ---------- Real posts behind a trend (readTrendPosts: free, it reads the posts research already saved) ----------

const PLATFORM = { x: ['X', '𝕏'], linkedin: ['LinkedIn', 'in'], reddit: ['Reddit', 'r/'] };
const clip = (value, size) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > size ? `${text.slice(0, size - 1)}…` : text; };
const webUrl = (value) => (/^https?:\/\/\S+$/i.test(String(value || '').trim()) ? String(value).trim() : '');
// One answer per trend for the session, shared by every card that shows it (Home, Trends, the board).
const postCache = new Map();
const postKey = (card) => String(card?.themeId || card?.name || '');
export function readTrendPostsOnce(api, card, limit = 2) {
  const key = postKey(card);
  if (!key || typeof api?.readTrendPosts !== 'function') return Promise.reject(new Error('unavailable'));
  if (!postCache.has(key)) {
    const request = Promise.resolve().then(() => api.readTrendPosts({ themeId: card.themeId || '', name: card.name || '', limit }))
      .then((result) => (Array.isArray(result) ? result : Array.isArray(result?.posts) ? result.posts : []).filter((post) => post && post.text).slice(0, limit));
    request.catch(() => postCache.delete(key)); // a failure isn't remembered; the next card asks again
    postCache.set(key, request);
  }
  return postCache.get(key);
}
export const forgetTrendPosts = () => postCache.clear(); // tests

// "Show 2 real posts": opens in place and reads once. When the posts can't be read the panel says so and the button
// stays (it has focus); closing and opening it again asks again.
function TrendPosts({ api, card }) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState(null); // null: not read yet
  const [failed, setFailed] = useState(false);
  const listId = useId();
  useEffect(() => {
    if (!open || posts) return undefined;
    let live = true;
    readTrendPostsOnce(api, card).then((rows) => { if (live) setPosts(rows); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, card?.themeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const openUrl = (url) => (typeof api?.openSourceUrl === 'function' ? Promise.resolve(api.openSourceUrl(url)).catch(() => {}) : window.open(url, '_blank', 'noopener'));
  return <div className="tp-posts-wrap">
    <button type="button" className="tp-why-ask tp-posts-toggle" aria-expanded={open} aria-controls={listId} onClick={() => { setFailed(false); setOpen((value) => !value); }}><MessageSquareQuote size={13} aria-hidden="true" />{open ? 'Hide the posts' : 'Show 2 real posts'}<ChevronDown size={13} aria-hidden="true" className="tp-posts-chevron" /></button>
    {open && <div id={listId} className="tp-posts" aria-live="polite">
      {failed ? <p className="tp-posts-empty" role="status">The posts couldn’t be read. Close this and try again.</p>
        : !posts ? <div className="tp-posts-loading" role="status" aria-label="Reading the posts"><span /><span /></div>
        : !posts.length ? <p className="tp-posts-empty">No posts saved for this trend.</p>
        : <ul>{posts.map((post, index) => { const [name, mark] = PLATFORM[post.platform] || ['Post', '•']; const url = webUrl(post.url); return <li key={url || index} className="tp-post">
          <p className="tp-post-head"><span className={`tp-post-mark is-${post.platform || 'web'}`} role="img" aria-label={name}>{mark}</span><strong>{clip(post.author, 60) || 'Someone'}</strong>{Number(post.engagement) > 0 && <small>{number(post.engagement)} engagements</small>}</p>
          <blockquote>{clip(post.text, 280)}</blockquote>
          {url && <a className="tp-post-link" href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); openUrl(url); }}>View post<ExternalLink size={12} aria-hidden="true" /></a>}
        </li>; })}</ul>}
    </div>}
  </div>;
}

// Why it matters, from what the studio knows without spending anything: novelty, momentum across runs, how often research
// has seen it, and which of the person's channels it fits (routed there, or open to every channel). With `api` (a role
// that reads research), two real posts open in place for free; Ask AI can then search for more.
export function WhyItMatters({ card, trend = null, fits = [], api = null, onAsk, className = '' }) {
  const runsSeen = Number(trend?.runsSeen) || Number(card?.detectionCount) || 0;
  const novelty = NOVELTY_LABEL[card?.novelty] || '';
  const parts = [novelty, runsSeen > 1 ? `Seen in ${number(runsSeen)} runs` : runsSeen === 1 ? 'First seen in this run' : ''].filter(Boolean);
  const posts = typeof api?.readTrendPosts === 'function' && Boolean(card?.themeId || card?.name);
  if (!parts.length && !trend?.momentum && !fits.length && !onAsk && !posts) return null;
  return <div className={`tp-why ${className}`.trim()}>
    <p className="tp-why-line"><span className="tp-why-label">Why it matters</span>{trend?.momentum && <MomentumBadge momentum={trend.momentum} />}{parts.map((part) => <span key={part}>{part}</span>)}{fits.length > 0 && <span className="tp-why-fits">Fits {fits.join(', ')}</span>}</p>
    {(posts || onAsk) && <div className="tp-why-actions">
      {posts && <TrendPosts api={api} card={card} />}
      {onAsk && <button type="button" className="tp-why-ask" onClick={() => onAsk(`What are people saying about “${card.name}”? Quote two short real posts from the research.`)}>{posts ? <Sparkles size={13} aria-hidden="true" /> : <MessageSquareQuote size={13} aria-hidden="true" />}{posts ? 'Ask AI for more' : 'What people are saying'}</button>}
    </div>}
  </div>;
}
