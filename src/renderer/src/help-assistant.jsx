import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Download, Image as ImageIcon, LoaderCircle, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import { MarkdownContent } from './markdown-content.jsx';
import './help-assistant.css';

// "Ask AI" in the header: questions about the app, answered from the app guide and the person's own setup,
// and pictures on request. Claude writes the picture prompt; the image provider draws it while the chat shows a
// placeholder. The conversation lasts for the session; the panel stays mounted so closing it keeps the thread.
const STARTERS = [
  'How do I run my first research program?',
  'What will a research run cost?',
  'Why did my last run stop?',
  'Create a hero image for my latest trend',
];
const money = (value) => (Number.isFinite(value) ? `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}` : '');
const ratio = (size) => String(size || '1536x1024').replace('x', ' / ');
let nextId = 0; const messageId = () => `m${++nextId}`;

function Picture({ image, onRetry, onDownload, onEnlarge }) {
  if (image.status === 'creating') return <div className="help-picture help-picture-pending" style={{ aspectRatio: ratio(image.size) }} role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span>Creating the picture… usually under a minute</span></div>;
  if (image.status === 'failed') return <div className="help-error" role="alert"><p>The picture wasn't created. {image.error}</p><button type="button" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Try again</button></div>;
  return <figure className="help-picture">
    <button type="button" className="help-picture-frame" onClick={onEnlarge} aria-label={`Enlarge ${image.title}`}><img src={image.dataUrl} alt={image.title} style={{ aspectRatio: ratio(image.size) }} /></button>
    <figcaption><span>{image.title}</span><button type="button" onClick={onDownload}><Download size={13} aria-hidden="true" />Download</button></figcaption>
    {image.costUsd != null && <small className="help-receipt">OpenAI image · {money(image.costUsd)}</small>}
  </figure>;
}

export function HelpAssistant({ api, open, onClose, page, onOpenPage, onOpenSettings, imagesReady = false }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [enlarged, setEnlarged] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  useEffect(() => { const list = listRef.current; if (list) list.scrollTop = list.scrollHeight; }, [messages, pending, error]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); if (enlarged) setEnlarged(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, enlarged]);
  if (!api?.askHelp) return null;

  const updateImage = (id, image) => setMessages((current) => current.map((message) => (message.id === id ? { ...message, image: { ...message.image, ...image } } : message)));
  async function drawPicture(id, request) {
    updateImage(id, { ...request, status: 'creating', error: '' });
    try { updateImage(id, { ...(await api.createHelpImage(request)), status: 'ready' }); }
    catch (failure) { updateImage(id, { status: 'failed', error: String(failure?.message || failure) }); }
  }
  async function ask(question = draft) {
    const text = String(question).trim();
    if (!text || pending) return;
    // Earlier picture prompts travel with the conversation so "make it bluer" can revise them.
    const history = messages.map(({ role, content, image }) => ({ role, content: image?.prompt ? `${content}\n[Picture created from this prompt: ${image.prompt}]` : content }));
    setMessages((current) => [...current, { id: messageId(), role: 'user', content: text }]);
    setDraft(''); setPending(true); setError(''); setNotice('');
    try {
      const reply = await api.askHelp({ question: text, history, page });
      const id = messageId();
      const request = reply.image && api.createHelpImage ? { title: reply.image.title, prompt: reply.image.prompt, size: reply.image.size } : null;
      setMessages((current) => [...current, { id, role: 'assistant', content: reply.answer, pages: reply.pages || [], followUps: reply.followUps || [], receipt: reply.receipt || null, image: request ? { ...request, status: 'creating' } : null }]);
      if (request) drawPicture(id, request);
    } catch (failure) {
      setError(String(failure?.message || failure));
    } finally { setPending(false); }
  }
  async function download(image) {
    try { const saved = await api.saveHelpImage({ id: image.id }); if (saved && !saved.cancelled) setNotice(`Saved ${saved.fileName || 'the picture'}.`); }
    catch (failure) { setError(String(failure?.message || failure)); }
  }
  const last = messages[messages.length - 1];

  return <aside id="help-drawer" className={`help-drawer${open ? ' open' : ''}`} aria-label="Ask AI about Scraper Studio" aria-hidden={!open} inert={!open}>
    <header className="help-head">
      <span className="help-mark" aria-hidden="true"><Sparkles size={17} /></span>
      <div><h2>Ask AI</h2><p>Questions about the app, or ask for a picture</p></div>
      {messages.length > 0 && <button type="button" className="help-icon" onClick={() => { setMessages([]); setError(''); setNotice(''); }} aria-label="Start a new conversation" title="New conversation"><RotateCcw size={15} /></button>}
      <button type="button" className="help-icon" onClick={onClose} aria-label="Close Ask AI" title="Close (Esc)"><X size={17} /></button>
    </header>
    <div className="help-messages" ref={listRef} role="log" aria-live="polite" aria-busy={pending}>
      {!messages.length && <div className="help-welcome">
        <h3>Ask anything about Scraper Studio</h3>
        <p>How a page works, what a run will cost, why something stopped, or what to do next. Answers use the app guide and your current setup. {imagesReady ? 'Ask for a picture and it appears right here.' : 'Add an OpenAI key in Settings → Image generation to make pictures here too.'}</p>
        <div className="help-starters">{STARTERS.filter((question) => imagesReady || !/image/i.test(question)).map((question) => <button type="button" key={question} onClick={() => ask(question)}><span>{question}</span>{/image/i.test(question) ? <ImageIcon size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}</button>)}</div>
      </div>}
      {messages.map((message) => message.role === 'user'
        ? <div className="help-question" key={message.id}>{message.content}</div>
        : <article className="help-answer" key={message.id} aria-label="Answer">
          <MarkdownContent>{message.content}</MarkdownContent>
          {message.image && <Picture image={message.image} onRetry={() => drawPicture(message.id, { title: message.image.title, prompt: message.image.prompt, size: message.image.size })} onDownload={() => download(message.image)} onEnlarge={() => setEnlarged(message.image)} />}
          {message.pages.length > 0 && <div className="help-pages">{message.pages.map((link) => <button type="button" key={link.page} onClick={() => onOpenPage(link.page)}>{link.label}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>}
          {message === last && message.followUps.length > 0 && !pending && <div className="help-followups">{message.followUps.map((question) => <button type="button" key={question} onClick={() => ask(question)}>{question}</button>)}</div>}
          {message.receipt && <small className="help-receipt">{[message.receipt.model, money(message.receipt.costUsd)].filter(Boolean).join(' · ')}</small>}
        </article>)}
      {pending && <div className="help-thinking" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" />Reading the guide and your setup…</div>}
      {notice && <p className="help-notice" role="status">{notice}</p>}
      {error && <div className="help-error" role="alert"><p>{error}</p>{onOpenSettings && /claude|api key|signed in|update|openai/i.test(error) && <button type="button" onClick={onOpenSettings}>Open Settings<ArrowRight size={13} aria-hidden="true" /></button>}</div>}
    </div>
    <form className="help-composer" onSubmit={(event) => { event.preventDefault(); ask(); }}>
      <textarea ref={inputRef} rows={2} value={draft} aria-label="Question about Scraper Studio" placeholder={imagesReady ? 'Ask how something works, or describe a picture…' : 'Ask how something works…'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} />
      <button type="submit" disabled={!draft.trim() || pending} aria-label="Send question"><ArrowUp size={16} /></button>
    </form>
    <p className="help-foot">Answers use your Claude connection, about $0.10 each.{imagesReady ? ' Pictures use OpenAI and cost a few cents each.' : ''} AI can be mistaken.</p>
    {enlarged && <div className="help-lightbox" role="dialog" aria-modal="true" aria-label={enlarged.title} onClick={() => setEnlarged(null)}>
      <img src={enlarged.dataUrl} alt={enlarged.title} />
      <button type="button" className="help-icon" onClick={() => setEnlarged(null)} aria-label="Close picture"><X size={18} /></button>
    </div>}
  </aside>;
}
