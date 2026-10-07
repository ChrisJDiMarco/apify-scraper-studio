import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Database, ExternalLink, MessageCircle, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { Badge, Button, number } from './ui.jsx';
import './findings-chat.css';
import { MarkdownContent } from './markdown-content.jsx';

const MAX_DATASETS = 8;

const STARTERS = [
  'What are the strongest themes in these findings? Cite examples.',
  'What differs across the selected sources, and what might explain it?',
  'What should our marketing team act on first, and what still needs validation?',
];

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch (_) { return ''; }
}

function Citation({ citation, index, onOpenSourceUrl }) {
  const href = sourceUrl(citation.url);
  const [openError, setOpenError] = useState('');
  async function openSource(event) {
    if (!onOpenSourceUrl) return;
    event.preventDefault();
    setOpenError('');
    try { await onOpenSourceUrl(href); }
    catch (error) { setOpenError(error?.message || 'Could not open this source. Try again.'); }
  }
  return <article className="findings-source">
    <div className="findings-source-top"><span className="findings-source-number">{index + 1}</span>{href ? <a href={href} onClick={openSource} target="_blank" rel="noopener noreferrer" aria-label={`Open source ${index + 1}: ${new URL(href).hostname}`}>{new URL(href).hostname}<ExternalLink size={12} aria-hidden="true" /></a> : <strong>Collected record</strong>}</div>
    {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
    <small>{citation.datasetName || citation.itemId}</small>
    {openError && <p className="findings-source-error" role="alert">{openError}</p>}
  </article>;
}

function Message({ message, onOpenSourceUrl }) {
  const isUser = message.role === 'user';
  const citations = Array.isArray(message.citations) ? message.citations : [];
  const caveats = Array.isArray(message.caveats) ? message.caveats : [];
  const coverage = message.coverage;
  const receipt = message.aiReceipt;
  const provider = receipt?.provider === 'claude' ? 'Claude CLI' : receipt?.provider === 'codex' ? 'Codex CLI' : receipt?.provider;
  const hasCost = typeof receipt?.costUsd === 'number' && Number.isFinite(receipt.costUsd) && receipt.costUsd >= 0;
  return <article className={`findings-message ${isUser ? 'from-user' : 'from-assistant'}`} aria-label={isUser ? 'Your question' : 'AI answer'}>
    <div className="findings-message-label">{isUser ? 'You' : <><Sparkles size={14} aria-hidden="true" />Research assistant</>}</div>
    {isUser ? <div className="findings-message-content">{String(message.content || '')}</div> : <MarkdownContent className="findings-answer" onOpenSourceUrl={onOpenSourceUrl} allowedSourceUrls={citations.map((citation) => citation.url)}>{String(message.content || message.answer || '')}</MarkdownContent>}
    {!isUser && citations.length > 0 && <details className="findings-sources"><summary>{citations.length} source{citations.length === 1 ? '' : 's'}<span>Inspect the evidence</span></summary><div className="findings-source-grid">{citations.map((citation, index) => <Citation key={`${citation.itemId}-${index}`} citation={citation} index={index} onOpenSourceUrl={onOpenSourceUrl} />)}</div></details>}
    {!isUser && caveats.length > 0 && <div className="findings-caveats"><strong>Keep in mind</strong><ul>{caveats.map((caveat, index) => <li key={index}>{String(caveat)}</li>)}</ul></div>}
    {!isUser && receipt && <div className="findings-receipt" aria-label="AI execution receipt">{provider && <Badge>{provider}</Badge>}{typeof receipt.actualModel === 'string' && receipt.actualModel && <Badge>{receipt.actualModel}</Badge>}<Badge>{hasCost ? `$${receipt.costUsd.toFixed(receipt.costUsd < 0.01 ? 4 : 2)} reported cost` : 'Cost not reported'}</Badge></div>}
    {!isUser && coverage && <small className="findings-coverage">Based on {number(coverage.includedItems)} of {number(coverage.availableItems)} loaded records{coverage.truncatedItems ? ` · ${number(coverage.truncatedItems)} excerpts shortened` : ''}.</small>}
  </article>;
}

export function FindingsChatView({ state, selectedDatasetId, onDatasetSelect, busy, onAskQuestion, onNavigate, onOpenSourceUrl }) {
  const datasets = state?.datasets || [];
  const conversations = state?.conversations || [];
  const [datasetIds, setDatasetIds] = useState(() => [datasets.find((dataset) => dataset.id === selectedDatasetId)?.id || datasets[0]?.id].filter(Boolean));
  const [conversationId, setConversationId] = useState('');
  const [returnedConversation, setReturnedConversation] = useState(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [error, setError] = useState('');
  const composer = useRef(null);
  const transcript = useRef(null);
  const mounted = useRef(true);
  const retryRequest = useRef(null);
  const stateConversation = conversations.find((conversation) => conversation.id === conversationId);
  const localConversation = returnedConversation?.id === conversationId ? returnedConversation : null;
  const conversation = localConversation && (!stateConversation || (localConversation.messages?.length || 0) >= (stateConversation.messages?.length || 0)) ? localConversation : stateConversation;
  const messages = (conversation?.messages || []).filter((message) => ['user', 'assistant'].includes(message.role));
  const availableIds = datasetIds.filter((id) => datasets.some((dataset) => dataset.id === id));
  const locked = Boolean(busy || pending);
  const selectedRows = datasets.filter((dataset) => availableIds.includes(dataset.id)).reduce((sum, dataset) => sum + (Number(dataset.itemCount) || 0), 0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (selectedDatasetId && datasets.some((dataset) => dataset.id === selectedDatasetId)) {
      setDatasetIds((current) => current.includes(selectedDatasetId) ? current : [selectedDatasetId]);
      setConversationId('');
      setReturnedConversation(null);
      retryRequest.current = null;
    }
  }, [selectedDatasetId]);

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length, pending, conversationId]);

  function changeSelection(id) {
    if (!availableIds.includes(id) && availableIds.length >= MAX_DATASETS) return;
    retryRequest.current = null;
    const next = availableIds.includes(id) ? availableIds.filter((value) => value !== id) : [...availableIds, id];
    setDatasetIds(next);
    setConversationId('');
    setReturnedConversation(null);
    setError('');
  }

  function openConversation(next) {
    retryRequest.current = null;
    setConversationId(next.id);
    setReturnedConversation(null);
    setDatasetIds([...new Set(next.datasetIds || [])]);
    setDraft('');
    setError('');
  }

  function newConversation() {
    retryRequest.current = null;
    setConversationId('');
    setReturnedConversation(null);
    setDraft('');
    setError('');
    composer.current?.focus();
  }

  async function submit(event) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || !availableIds.length || availableIds.length > MAX_DATASETS || locked || !onAskQuestion) return;
    const requestKey = JSON.stringify({ datasetIds: [...availableIds].sort(), question, conversationId });
    if (retryRequest.current?.key !== requestKey) {
      const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      retryRequest.current = { key: requestKey, id: `chat-request-${token}` };
    }
    const requestId = retryRequest.current.id;
    setPending(true);
    setPendingQuestion(question);
    setError('');
    try {
      const result = await onAskQuestion({ datasetIds: availableIds, question, requestId, ...(conversationId ? { conversationId } : {}) });
      if (!mounted.current) return;
      const next = result?.conversation || result;
      if (!next?.id || !Array.isArray(next.messages)) throw new Error('The answer was not returned. Your question is saved below; try again.');
      setReturnedConversation(next);
      setConversationId(next.id);
      setDraft('');
      retryRequest.current = null;
    } catch (failure) {
      if (mounted.current) setError(failure?.message || 'The question could not be answered. Try again.');
    } finally {
      if (mounted.current) { setPending(false); setPendingQuestion(''); }
    }
  }

  if (!datasets.length) return <section className="panel findings-empty">
    <span className="findings-empty-icon"><MessageCircle size={30} aria-hidden="true" /></span>
    <span className="data-eyebrow">TALK TO YOUR FINDINGS</span>
    <h2>Turn collected data into a conversation.</h2>
    <p>Search with your scrapers first. Then ask questions, compare platforms, and follow the evidence behind every answer.</p>
    <Button onClick={() => onNavigate?.('search')}>Start a search <ArrowRight size={16} aria-hidden="true" /></Button>
  </section>;

  return <section className="findings-workspace">
    <aside className="panel findings-sidebar">
      <div className="panel-head"><h3>Your evidence</h3><Badge>{availableIds.length} / {MAX_DATASETS} selected</Badge></div>
      <p className="findings-sidebar-note">Choose up to eight datasets to ask about. Changing this selection starts a new conversation.</p>
      <fieldset className="findings-dataset-list" disabled={locked}><legend className="findings-sr-only">Datasets for this conversation</legend>{datasets.map((dataset) => <label key={dataset.id} className={`findings-dataset ${availableIds.includes(dataset.id) ? 'selected' : ''}`}>
        <input type="checkbox" checked={availableIds.includes(dataset.id)} disabled={!availableIds.includes(dataset.id) && availableIds.length >= MAX_DATASETS} onChange={() => changeSelection(dataset.id)} />
        <span><strong>{dataset.name}</strong>{' '}<small>{dataset.platform || 'Web'} · {number(dataset.itemCount)} records</small></span>
      </label>)}</fieldset>
      {availableIds.length >= MAX_DATASETS && <p className="findings-selection-note" role="status">Eight datasets maximum. Deselect one to add another.</p>}
      {availableIds.length === 1 && onDatasetSelect && <Button className="ghost findings-inspect" disabled={locked} onClick={() => { onDatasetSelect(availableIds[0]); onNavigate?.('datasets'); }}><Database size={14} aria-hidden="true" />Inspect dataset</Button>}
      <div className="findings-history-head"><h3>Conversations</h3><Button className="ghost" disabled={locked} onClick={newConversation} aria-label="New conversation"><Plus size={16} aria-hidden="true" /></Button></div>
      <div className="findings-history">{conversations.length ? conversations.map((item) => <button type="button" key={item.id} className={`ghost ${item.id === conversationId ? 'active' : ''}`} aria-pressed={item.id === conversationId} disabled={locked} onClick={() => openConversation(item)}><MessageCircle size={14} aria-hidden="true" /><span>{item.title || 'Conversation'}</span></button>) : <p>Your saved conversations will appear here.</p>}</div>
    </aside>
    <div className="panel findings-main">
      <header className="findings-heading"><div><span className="data-eyebrow">YOUR RESEARCH, EXPLAINED</span><h2 title={conversation?.title || 'Ask your findings'}>{conversation?.title || 'Ask your findings'}</h2><p>{number(selectedRows)} records across {availableIds.length} dataset{availableIds.length === 1 ? '' : 's'} · Answers use a bounded evidence sample</p></div><span className="findings-assistant-mark"><Sparkles size={22} aria-hidden="true" /></span></header>
      <div ref={transcript} className="findings-transcript" role="log" aria-label="Findings conversation" aria-live="polite" aria-busy={pending}>
        {!messages.length && !pending ? <div className="findings-welcome"><span className="findings-welcome-icon"><Sparkles size={25} aria-hidden="true" /></span><h3>What would you like to understand?</h3><p>Find patterns, challenge a conclusion, or turn the research into next steps. Start with a question below.</p><div className="findings-starters">{STARTERS.map((question) => <button type="button" key={question} className="ghost" disabled={locked || !availableIds.length} onClick={() => { setDraft(question); composer.current?.focus(); }}>{question}<ArrowRight size={15} aria-hidden="true" /></button>)}</div></div> : messages.map((message, index) => <Message key={message.id || `${conversationId}-${index}`} message={message} onOpenSourceUrl={onOpenSourceUrl} />)}
        {pending && <><Message message={{ role: 'user', content: pendingQuestion }} /><div className="findings-working" role="status"><span />Reading your selected evidence…</div></>}
      </div>
      <form className="findings-composer" onSubmit={submit}>
        {error && <div className="findings-error" role="alert"><span>{error}</span><Button type="button" className="ghost" disabled={locked || !draft.trim() || !availableIds.length || availableIds.length > MAX_DATASETS} onClick={submit}><RefreshCw size={14} aria-hidden="true" />Retry</Button></div>}
        {!availableIds.length && <p className="findings-selection-note">Select at least one dataset to start.</p>}
        <div className="findings-composer-box"><textarea ref={composer} aria-label="Question about your findings" placeholder="Ask a question about your findings…" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} disabled={locked || !availableIds.length} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event); }} /><Button type="submit" disabled={locked || !draft.trim() || !availableIds.length || availableIds.length > MAX_DATASETS || !onAskQuestion} aria-label={pending ? 'Answering question' : 'Ask question'}><ArrowUp size={19} aria-hidden="true" /></Button></div>
        <div className="findings-composer-foot"><span>AI answers can be mistaken. Open the sources before acting.</span><span>⌘ / Ctrl + Enter</span></div>
      </form>
    </div>
  </section>;
}
