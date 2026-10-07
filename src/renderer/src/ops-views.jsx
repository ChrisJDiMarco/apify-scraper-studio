import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderOpen, LoaderCircle, MessagesSquare, Search, Sparkles } from 'lucide-react';
import { latestAnalysisForDataset } from '../../shared/analysis.js';
import { groupThreads } from '../../shared/dashboard.js';
import { authorName } from '../../shared/dataset-insights.js';
import { Button, number, short } from './ui.jsx';
import { platformName } from './dataset-hub.jsx';
import './workspace-pages.css';

const PAGE = 30;

function BulletGroup({ title, items = [] }) {
  if (!items.length) return null;
  return <div className="ws-thread-bullets"><span>{title}</span><ul>{items.slice(0, 3).map((item, index) => <li key={`${title}-${index}`}>{short(item, 140)}</li>)}</ul></div>;
}

function ConversationSummaries({ analysis, output, busy, canSummarize, onSummarize, onOpenAnalysisOutput, onRevealAnalysisOutput }) {
  if (!analysis) return <div className="ws-card ws-summary-cta"><span className="ws-state review"><Sparkles size={16} aria-hidden="true" /></span><div><h3>Summarize these conversations</h3><p className="ws-hint">AI groups the threads and pulls out the arguments, objections, leads, and risks, with each point tied back to the conversation it came from.</p></div><Button disabled={busy || !canSummarize} onClick={onSummarize}><Sparkles size={14} aria-hidden="true" />Summarize conversations</Button></div>;
  if (analysis.status === 'running') return <div className="ws-card ws-summary-cta" role="status"><span className="ws-state active"><LoaderCircle size={16} className="spin" aria-hidden="true" /></span><div><h3>Summarizing conversations</h3><p className="ws-hint">This usually takes a minute or two. You can keep working; the summary appears here when it’s ready.</p></div></div>;
  if (analysis.status === 'failed') return <div className="ws-card ws-summary-cta"><span className="ws-state attention"><Sparkles size={16} aria-hidden="true" /></span><div><h3>The summary didn’t finish</h3><p className="ws-hint">{analysis.error || 'Try again when you’re ready.'}</p></div><Button disabled={busy || !canSummarize} onClick={onSummarize}>Try again</Button></div>;
  if (output?.loading) return <div className="ws-skeleton" aria-busy="true" aria-label="Loading summary" />;
  if (output?.error) return <div className="ws-callout attention">{output.error}</div>;
  const summaries = output?.output?.threads || [];
  if (!summaries.length) return <div className="ws-card ws-summary-cta"><span className="ws-state"><Sparkles size={16} aria-hidden="true" /></span><div><h3>No summaries in the last run</h3><p className="ws-hint">The analysis finished without grouping any threads. Run it again after collecting replies.</p></div><Button disabled={busy || !canSummarize} onClick={onSummarize}>Summarize again</Button></div>;
  const count = (key) => summaries.reduce((total, thread) => total + (thread[key]?.length || 0), 0);
  return <section className="ws-card">
    <div className="ws-card-head"><div><h3>What these conversations say</h3><p className="ws-hint">{number(summaries.length)} threads · {number(count('notableArguments'))} arguments · {number(count('objections'))} objections · {number(count('leads'))} leads</p></div>
      <div className="ws-head-actions">{analysis.outputPath && <Button className="ghost" disabled={busy} onClick={() => onOpenAnalysisOutput(analysis.id)}><ExternalLink size={13} aria-hidden="true" />Open</Button>}{analysis.outputPath && <Button className="ghost" disabled={busy} onClick={() => onRevealAnalysisOutput(analysis.id)}><FolderOpen size={13} aria-hidden="true" />Show in Finder</Button>}<Button className="ghost" disabled={busy || !canSummarize} onClick={onSummarize}>Refresh</Button></div></div>
    <div className="ws-summary-grid">{summaries.slice(0, 6).map((thread) => <article key={thread.threadId} className="ws-summary"><strong>{thread.title}</strong><p>{short(thread.summary, 240)}</p><BulletGroup title="Arguments" items={thread.notableArguments} /><BulletGroup title="Objections" items={thread.objections} /><BulletGroup title="Leads" items={thread.leads} /><BulletGroup title="Risks" items={thread.risks} /></article>)}</div>
  </section>;
}

export function ThreadsView({ payload, selectedDataset, state, onAnalyze, onReadAnalysis, onOpenAnalysisOutput, onRevealAnalysisOutput, busy }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [threadOutput, setThreadOutput] = useState(null);
  const allThreads = useMemo(() => groupThreads(payload?.items || []), [payload]);
  const needle = query.trim().toLowerCase();
  const threads = needle ? allThreads.filter((thread) => thread.items.some((item) => `${item.text || ''} ${authorName(item.author)}`.toLowerCase().includes(needle))) : allThreads;
  const replies = allThreads.reduce((total, thread) => total + thread.replies.length, 0);
  const latest = latestAnalysisForDataset(state?.analyses || [], selectedDataset?.id || '', 'thread');
  useEffect(() => { setShown(PAGE); }, [query, selectedDataset?.id]);
  useEffect(() => {
    if (!latest?.id || latest.status !== 'succeeded') { setThreadOutput(null); return undefined; }
    let cancelled = false;
    setThreadOutput({ loading: true });
    onReadAnalysis(latest.id).then((output) => { if (!cancelled) setThreadOutput(output); }).catch((error) => { if (!cancelled) setThreadOutput({ error: error.message || String(error) }); });
    return () => { cancelled = true; };
  }, [latest?.id, latest?.status, onReadAnalysis]);

  return <div className="ws-stack">
    <ConversationSummaries analysis={latest} output={threadOutput} busy={busy} canSummarize={Boolean(selectedDataset && allThreads.length)} onSummarize={() => onAnalyze(selectedDataset.id, 'thread')} onOpenAnalysisOutput={onOpenAnalysisOutput} onRevealAnalysisOutput={onRevealAnalysisOutput} />
    <div className="ws-toolbar"><label className="ws-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts and replies…" /></label><p className="ws-hint">{number(allThreads.length)} conversations · {number(replies)} replies{needle ? ` · ${number(threads.length)} match` : ''}</p></div>
    {threads.length ? <ul className="ws-thread-list">{threads.slice(0, shown).map((thread) => <li key={thread.id} className="ws-thread">
      <header><span className="ws-chip">{platformName(thread.root?.platform || selectedDataset?.platform)}</span>{authorName(thread.root?.author) && <strong>{authorName(thread.root.author)}</strong>}<span className="ws-thread-count">{thread.replies.length ? `${number(thread.replies.length)} ${thread.replies.length === 1 ? 'reply' : 'replies'}` : 'No replies collected'}</span></header>
      <p>{short(thread.root?.text || thread.root?.url || thread.id, 320)}</p>
      {thread.replies.length > 0 && <ul className="ws-replies">{thread.replies.slice(0, 3).map((reply) => <li key={reply.id}><strong>{authorName(reply.author) || 'Reply'}</strong> {short(reply.text || reply.url || reply.id, 200)}</li>)}{thread.replies.length > 3 && <li className="ws-hint">+{number(thread.replies.length - 3)} more</li>}</ul>}
    </li>)}</ul> : <div className="ws-empty"><MessagesSquare size={22} aria-hidden="true" /><h3>{needle ? 'No conversations match' : 'No conversations yet'}</h3><p>{needle ? 'Try another word.' : 'Collect posts with their comments and they’ll be grouped into conversations here.'}</p></div>}
    {threads.length > shown && <Button className="ghost ws-more" onClick={() => setShown((count) => count + PAGE)}>Show {number(Math.min(PAGE, threads.length - shown))} more</Button>}
  </div>;
}
