import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Check, ChevronLeft, ChevronRight, Copy, FileText, Folder, Pencil, RotateCcw, TrendingUp, Activity, BellRing } from 'lucide-react';
import { MarkdownBlocks, MarkdownContent } from './markdown-content.jsx';
import { copyableMarkdown, splitBlocks, stabilizeTail, streamDisplay, studioLinks } from './ask-markdown.js';
import { isFinal, useAskProgress, useSmoothText } from './ask-stream.js';
import { AskSteps, AskTypingDots } from './ask-steps.jsx';
import { formatDay, formatTime } from './viewer.js';

// The Ask AI conversation as it reads: day dividers, each question with its answer, the answer streaming in place with
// a caret, the steps line over it, and under it the tools (copy, retry, earlier versions, time and cost). The newest
// question is pinned near the top with room reserved under it, so the answer streams into empty space and nothing
// scrolls until it fills the view; after that the view follows the end of the text unless the person scrolled up, and a
// "Jump to latest" pill takes them back. help-assistant.jsx keeps the conversations, memory and buttons; this file only
// lays the thread out. Class names the rest of the app and its tests know (.help-messages, .help-question,
// .help-answer, .help-read, .help-receipt) are kept.

const list = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(value) ? `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}` : '');
const ATTACH_ICONS = { report: FileText, 'asset-folder': Folder, trend: TrendingUp, run: Activity };
const ATTACH_WORD = { report: 'Report', 'asset-folder': 'Folder', trend: 'Trend', run: 'Run' };
export const receiptText = (receipt) => (receipt ? [receipt.route === 'codex' ? 'Codex (not metered)' : receipt.model, money(receipt.costUsd)].filter(Boolean).join(' · ') : '');
function dayLabel(value) {
  const date = new Date(value || 0); if (!value || Number.isNaN(date.getTime())) return '';
  const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDay(value);
}
const keyOf = (message) => message.key || message.id;

// Questions with their answers. A studio follow-up (or an answer with no question before it) is a turn of its own.
export function groupTurns(messages) {
  const turns = []; let current = null;
  for (const message of list(messages)) {
    if (message.role === 'user' || !current || message.followUp || (current.answers.length && !current.user)) {
      current = { key: keyOf(message), user: message.role === 'user' ? message : null, answers: message.role === 'user' ? [] : [message], day: dayLabel(message.createdAt) };
      turns.push(current);
    } else current.answers.push(message);
  }
  return turns;
}

// Follows the end of the thread while the person hasn't scrolled away: `follow` is cleared by an upward wheel, a touch
// drag, PageUp/Home/↑ in the thread or any scroll the panel didn't make, and set again at the bottom or by jump().
// pin(element) brings a new question to 16 px below the top. Works without ResizeObserver (it then simply doesn't
// follow by itself) and without smooth scrolling (instant).
export function useStickToBottom(scrollerRef, contentRef, { reduced = false } = {}) {
  const [atBottom, setAtBottom] = useState(true);
  const follow = useRef(true); const ours = useRef(0);
  const distance = () => { const box = scrollerRef.current; return box ? box.scrollHeight - box.scrollTop - box.clientHeight : 0; };
  const scrollTo = useCallback((top, smooth) => {
    const box = scrollerRef.current; if (!box) return;
    const animate = smooth && !reduced && typeof box.scrollTo === 'function';
    ours.current = Date.now() + (animate ? 700 : 120);
    if (animate) box.scrollTo({ top, behavior: 'smooth' }); else box.scrollTop = top;
  }, [reduced, scrollerRef]);
  const toBottom = useCallback((smooth = false) => { const box = scrollerRef.current; if (box) scrollTo(box.scrollHeight, smooth); }, [scrollTo, scrollerRef]);
  useEffect(() => {
    const box = scrollerRef.current; if (!box) return undefined;
    const onScroll = () => { const near = distance() <= 64; setAtBottom(near); if (Date.now() > ours.current) follow.current = near; else if (near) follow.current = true; };
    const away = () => { follow.current = false; ours.current = 0; };
    const onWheel = (event) => { if (event.deltaY < 0) away(); };
    const onKey = (event) => { if (['PageUp', 'Home', 'ArrowUp'].includes(event.key) && event.target === box) away(); };
    box.addEventListener('scroll', onScroll, { passive: true }); box.addEventListener('wheel', onWheel, { passive: true }); box.addEventListener('touchmove', away, { passive: true }); box.addEventListener('keydown', onKey);
    return () => { box.removeEventListener('scroll', onScroll); box.removeEventListener('wheel', onWheel); box.removeEventListener('touchmove', away); box.removeEventListener('keydown', onKey); };
  }, [scrollerRef]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const content = contentRef.current; if (!content || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => { if (follow.current) toBottom(false); else setAtBottom(distance() <= 64); });
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, toBottom]); // eslint-disable-line react-hooks/exhaustive-deps
  const jump = useCallback(() => { follow.current = true; setAtBottom(true); toBottom(true); }, [toBottom]);
  const pin = useCallback((element) => {
    const box = scrollerRef.current; if (!box || !element) return;
    follow.current = true;
    const top = element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
    scrollTo(Math.max(0, top), true);
  }, [scrollTo, scrollerRef]);
  return { atBottom, jump, pin, toBottom, follow };
}

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    const value = copyableMarkdown(text);
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch {
      try { const area = Object.assign(document.createElement('textarea'), { value }); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); document.execCommand?.('copy'); area.remove(); setCopied(true); } catch { /* nothing to copy with */ }
    }
  }
  return <button type="button" className="ask-tool" aria-label={copied ? copiedLabel : label} title={copied ? copiedLabel : label} onClick={copy}>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied && <span className="ask-tool-note" aria-hidden="true">{copiedLabel}</span>}</button>;
}

function AskUserMessage({ message, editing, canEdit, onEditStart, onEditCancel, onEditSend }) {
  const [text, setText] = useState(message.content);
  const boxRef = useRef(null);
  useEffect(() => { if (editing) { setText(message.content); requestAnimationFrame(() => { const box = boxRef.current; if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => { const next = text.trim(); if (next) onEditSend(next); };
  if (editing) return <form className="ask-user ask-edit" onSubmit={(event) => { event.preventDefault(); send(); }}>
    <textarea ref={boxRef} aria-label="Edit question" rows={2} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent?.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEditCancel(); }
      else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
    }} />
    <div className="ask-edit-buttons"><button type="button" className="help-chip-button" onClick={onEditCancel}>Cancel</button><button type="submit" className="help-chip-button is-primary" disabled={!text.trim()}>Send</button></div>
  </form>;
  const attached = list(message.attachments).filter((row) => row?.ref);
  return <div className="ask-user">
    <div className="help-question">
      {message.context && <small className="help-context"><FileText size={12} aria-hidden="true" />{message.contextLabel || 'With the report you had open'}</small>}
      {attached.length > 0 && <span className="ask-attached">{attached.map((row) => { const Icon = ATTACH_ICONS[row.kind] || FileText; return <small key={`${row.kind}:${row.ref}`} className="help-context"><Icon size={12} aria-hidden="true" />{ATTACH_WORD[row.kind] || 'Item'}: {row.ref}</small>; })}</span>}
      {message.content}
    </div>
    <div className="ask-tools ask-user-tools">
      {message.editedAt && <span className="ask-tool-meta">Edited</span>}
      <CopyButton text={message.content} label="Copy question" />
      {canEdit && <button type="button" className="ask-tool" aria-label="Edit question" title="Edit question (↑)" onClick={onEditStart}><Pencil size={13} aria-hidden="true" /></button>}
      {message.createdAt && <time className="ask-tool-meta" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>}
    </div>
  </div>;
}

// A streaming answer: finished blocks render once; the block being written is made safe to render (ask-markdown.js).
function StreamingAnswer({ text }) {
  const { stable, tail } = splitBlocks(text);
  return <MarkdownBlocks blocks={[...stable, stabilizeTail(tail)]} linksOff />;
}

// One answer, from its first "Thinking" to the finished reply with its cards. The same article holds it all the way,
// so nothing remounts or jumps when the reply lands: the streamed text keeps revealing until it has caught up with the
// finished text, and only then do the links, cards and buttons rise in under it.
function AskAssistantMessage({ message, store, liveStream, reduced, last, canRetry, onRetry, retryTitle, renderExtras, renderFollowUps, renderFailure }) {
  const progress = useAskProgress(store, message.requestId || '');
  const [version, setVersion] = useState(0);
  const revealed = useRef(false);
  const settled = !message.pending && !message.failed;
  const animate = Boolean(message.requestId) && liveStream && (message.pending || message.failed || message.streamed);
  const goal = settled ? streamDisplay(message.content) : streamDisplay(progress?.text || '');
  const smooth = useSmoothText(animate ? goal : '', { live: message.pending && !isFinal(progress?.status), reduced });
  if (settled && (!animate || smooth.done)) revealed.current = true;
  const showFinal = settled && revealed.current;
  const versions = list(message.versions);
  const older = version > 0 ? versions[version - 1] : null;
  const shown = showFinal ? studioLinks(older ? older.content : message.content) : null;
  const streamingNow = !showFinal && !message.failed && Boolean(smooth.text);
  const live = Boolean(message.requestId) && (message.pending || message.failed || !revealed.current || progress?.steps?.length);
  const status = message.failed ? (message.stoppedEmpty ? 'stopped' : 'failed') : message.pending ? (liveStream ? progress?.status || 'sending' : 'thinking') : (message.stopped ? 'stopped' : 'done');
  const reads = list(message.read).map((row) => `“${row.title}”`);
  const readLabel = reads.length ? `Read ${reads.join(', ')}` : '';
  return <article className={`help-answer${streamingNow ? ' ask-streaming' : ''}${message.failed ? ' is-failed' : ''}${message.stopped ? ' is-stopped' : ''}${message.followUp ? ' is-followup' : ''}`} aria-label={message.pending || (!showFinal && !message.failed) ? 'Answering' : 'Answer'} aria-busy={message.pending ? true : undefined} data-request={message.requestId || undefined}>
    {message.followUp && <small className="help-followup-kicker"><BellRing size={12} aria-hidden="true" />From the studio{message.createdAt ? ` · ${formatTime(message.createdAt)}` : ''}</small>}
    {live ? <AskSteps status={status} steps={progress?.steps || []} startedAt={message.startedMs || 0} doneLabel={readLabel} />
      : readLabel && <small className="help-read ask-read">{readLabel}</small>}
    {!showFinal && !message.failed && !smooth.text && <AskTypingDots />}
    {!showFinal && smooth.text && <div className={message.failed ? 'ask-partial' : undefined}><StreamingAnswer text={smooth.text} /></div>}
    {showFinal && <MarkdownContent>{shown.text}</MarkdownContent>}
    {showFinal && older && <p className="ask-note">An earlier answer. Its buttons are off; follow-ups use the newest answer.</p>}
    {showFinal && !older && renderExtras?.(message, { last, links: shown.links })}
    {showFinal && message.stopped && <p className="ask-note">Stopped. What was written so far is kept.</p>}
    {message.failed && renderFailure?.(message)}
    {showFinal && <div className={`ask-tools${last ? ' is-last' : ''}`}>
      <CopyButton text={older ? older.content : message.content} label="Copy answer" />
      {last && canRetry && !older && <button type="button" className="ask-tool" aria-label="Retry" title={retryTitle || 'Ask again'} onClick={() => onRetry(message)}><RotateCcw size={13} aria-hidden="true" /></button>}
      {versions.length > 0 && <span className="ask-versions" role="group" aria-label="Versions of this answer">
        <button type="button" className="ask-tool" aria-label="Earlier answer" disabled={version >= versions.length} onClick={() => setVersion((value) => Math.min(versions.length, value + 1))}><ChevronLeft size={13} aria-hidden="true" /></button>
        <span className="ask-tool-meta">{versions.length + 1 - version} of {versions.length + 1}</span>
        <button type="button" className="ask-tool" aria-label="Newer answer" disabled={version === 0} onClick={() => setVersion((value) => Math.max(0, value - 1))}><ChevronRight size={13} aria-hidden="true" /></button>
      </span>}
      {(older?.createdAt || message.createdAt) && <time className="ask-tool-meta" dateTime={older?.createdAt || message.createdAt}>{formatTime(older?.createdAt || message.createdAt)}</time>}
      {(older ? older.receipt : message.receipt) && receiptText(older ? older.receipt : message.receipt) && <small className="help-receipt">{receiptText(older ? older.receipt : message.receipt)}</small>}
    </div>}
    {showFinal && !older && last && renderFollowUps?.(message)}
  </article>;
}

function AskJumpToLatest({ streaming, onJump }) {
  return <button type="button" className="ask-jump" onClick={onJump}><ArrowDown size={14} aria-hidden="true" />{streaming ? 'New text below' : 'Jump to latest'}</button>;
}

// What screen readers hear: steps (at most one every 2 s), "Answer ready. …", "Stopped." and errors. The thread itself is
// aria-live off, so streamed words never flood them.
export function AskAnnouncer({ text = '' }) {
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{text}</div>;
}

// messages: the panel's rows (user, assistant, and assistant placeholders { pending, requestId } while answering).
// pinnedKey: the newest question's key, which gets the room under it; editingKey: the question being edited.
export function AskThread({ messages, store, liveStream = false, reduced = false, hidden = false, busy = false, opening = false, welcome = null, pinnedKey = '', pinSignal = 0, editingKey = '', canEdit, onEditStart, onEditCancel, onEditSend, canRetry, onRetry, retryTitle, renderExtras, renderFollowUps, renderFailure, announcement = '', scrollRef }) {
  const scrollerRef = useRef(null); const contentRef = useRef(null);
  const { atBottom, jump, pin, toBottom } = useStickToBottom(scrollerRef, contentRef, { reduced });
  const [room, setRoom] = useState(0);
  const setScroller = useCallback((node) => { scrollerRef.current = node; if (scrollRef) scrollRef.current = node; }, [scrollRef]);
  useEffect(() => {
    const box = scrollerRef.current; if (!box || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => { const style = getComputedStyle(box); setRoom(Math.max(0, Math.round(box.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)))); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // A new question goes near the top; a conversation that just opened starts at its end.
  useLayoutEffect(() => {
    if (!pinnedKey) return;
    const element = [...(scrollerRef.current?.querySelectorAll('[data-turn]') || [])].find((node) => node.getAttribute('data-turn') === pinnedKey);
    if (element) pin(element);
  }, [pinnedKey, pinSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstKey = keyOf(messages[0] || {}) || '';
  useLayoutEffect(() => { if (!pinnedKey) toBottom(false); }, [firstKey, opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const turns = groupTurns(messages);
  const days = new Set(turns.map((turn) => turn.day).filter(Boolean));
  const streaming = messages.some((message) => message.pending);
  const lastTurn = turns[turns.length - 1];
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  let shownDay = '';
  return <div className="ask-thread-wrap" hidden={hidden}>
    <div className="help-messages" ref={setScroller} role="log" aria-live="off" aria-busy={busy} aria-label="Conversation" tabIndex={-1}>
      <div className="ask-thread" ref={contentRef}>
        {opening && !messages.length && <p className="help-thinking" role="status"><span className="ask-typing" aria-hidden="true"><i /><i /><i /></span>Opening the conversation…</p>}
        {!messages.length && !opening && welcome}
        {turns.map((turn) => {
          const divider = days.size > 1 && turn.day && turn.day !== shownDay; if (divider) shownDay = turn.day;
          const isLast = turn === lastTurn; const reserve = isLast && pinnedKey && turn.key === pinnedKey && room > 0;
          return <React.Fragment key={turn.key}>
            {divider && <p className="ask-day"><span>{turn.day}</span></p>}
            <section className={`ask-turn${isLast ? ' is-last' : ''}`} data-turn={turn.key} style={reserve ? { '--ask-turn-min': `${room}px` } : undefined}>
              {turn.user && <AskUserMessage message={turn.user} editing={editingKey === keyOf(turn.user)} canEdit={Boolean(canEdit?.(turn.user)) && turn.user === lastUser && !streaming} onEditStart={() => onEditStart?.(turn.user)} onEditCancel={() => onEditCancel?.()} onEditSend={(text) => onEditSend?.(turn.user, text)} />}
              {turn.answers.map((message, index) => <AskAssistantMessage key={keyOf(message)} message={message} store={store} liveStream={liveStream} reduced={reduced} last={isLast && index === turn.answers.length - 1} canRetry={Boolean(canRetry?.(message, turn.user))} onRetry={(row) => onRetry?.(row, turn.user)} retryTitle={retryTitle} renderExtras={renderExtras} renderFollowUps={renderFollowUps} renderFailure={renderFailure} />)}
            </section>
          </React.Fragment>;
        })}
      </div>
    </div>
    {!atBottom && messages.length > 0 && !hidden && <AskJumpToLatest streaming={streaming} onJump={jump} />}
    <AskAnnouncer text={announcement} />
  </div>;
}
