import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import './help-assistant.css';

// "Ask AI" in the header: questions about the app, answered from the app guide and the person's own setup.
// The conversation lasts for the session; the panel stays mounted so closing it keeps the thread.
const STARTERS = [
  'How do I run my first research program?',
  'What will a research run cost?',
  'Why did my last run stop?',
  'How do I share my setup with a teammate?',
];
const money = (value) => (Number.isFinite(value) ? `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}` : '');

export function HelpAssistant({ api, open, onClose, page, onOpenPage, onOpenSettings }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  useEffect(() => { const list = listRef.current; if (list) list.scrollTop = list.scrollHeight; }, [messages, pending, error]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!api?.askHelp) return null;

  async function ask(question = draft) {
    const text = String(question).trim();
    if (!text || pending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setDraft(''); setPending(true); setError('');
    try {
      const reply = await api.askHelp({ question: text, history, page });
      setMessages((current) => [...current, { role: 'assistant', content: reply.answer, pages: reply.pages || [], followUps: reply.followUps || [], receipt: reply.receipt || null }]);
    } catch (failure) {
      setError(String(failure?.message || failure));
    } finally { setPending(false); }
  }
  const last = messages[messages.length - 1];

  return <aside id="help-drawer" className={`help-drawer${open ? ' open' : ''}`} aria-label="Ask AI about Scraper Studio" aria-hidden={!open} inert={!open}>
    <header className="help-head">
      <span className="help-mark" aria-hidden="true"><Sparkles size={17} /></span>
      <div><h2>Ask AI</h2><p>About this app, its pages and your runs</p></div>
      {messages.length > 0 && <button type="button" className="help-icon" onClick={() => { setMessages([]); setError(''); }} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
      <button type="button" className="help-icon" onClick={onClose} aria-label="Close Ask AI" title="Close (Esc)"><X size={17} /></button>
    </header>
    <div className="help-messages" ref={listRef} role="log" aria-live="polite" aria-busy={pending}>
      {!messages.length && <div className="help-welcome">
        <h3>Ask anything about Scraper Studio</h3>
        <p>How a page works, what a run will cost, why something stopped, or what to do next. Answers use the app guide and your current setup.</p>
        <div className="help-starters">{STARTERS.map((question) => <button type="button" key={question} onClick={() => ask(question)}><span>{question}</span><ArrowRight size={14} aria-hidden="true" /></button>)}</div>
      </div>}
      {messages.map((message, index) => message.role === 'user'
        ? <div className="help-question" key={index}>{message.content}</div>
        : <article className="help-answer" key={index} aria-label="Answer">
          <MarkdownContent>{message.content}</MarkdownContent>
          {message.pages.length > 0 && <div className="help-pages">{message.pages.map((link) => <button type="button" key={link.page} onClick={() => onOpenPage(link.page)}>{link.label}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>}
          {message === last && message.followUps.length > 0 && !pending && <div className="help-followups">{message.followUps.map((question) => <button type="button" key={question} onClick={() => ask(question)}>{question}</button>)}</div>}
          {message.receipt && <small className="help-receipt">{[message.receipt.model, money(message.receipt.costUsd)].filter(Boolean).join(' · ')}</small>}
        </article>)}
      {pending && <div className="help-thinking" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" />Reading the guide and your setup…</div>}
      {error && <div className="help-error" role="alert"><p>{error}</p>{onOpenSettings && /claude|api key|signed in|update/i.test(error) && <button type="button" onClick={onOpenSettings}>Open Settings → Writing & research<ArrowRight size={13} aria-hidden="true" /></button>}</div>}
    </div>
    <form className="help-composer" onSubmit={(event) => { event.preventDefault(); ask(); }}>
      <textarea ref={inputRef} rows={2} value={draft} aria-label="Question about Scraper Studio" placeholder="Ask how something works…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} />
      <button type="submit" disabled={!draft.trim() || pending} aria-label="Send question"><ArrowUp size={16} /></button>
    </form>
    <p className="help-foot">Uses your Claude connection, about $0.10 a question. AI answers can be mistaken.</p>
  </aside>;
}
