import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Circle } from 'lucide-react';
import { isFinal } from './ask-stream.js';

// The one line over an answer that says what Ask AI is doing: "Reading “Zero-click report” · 4s" while it works, and
// "Read 2 things · 9s", "Thought for 4s" or "Stopped after 6s" once it's done. Its height never changes, so the answer
// under it never moves. A disclosure opens every step. Times are counted here (performance.now), never from the
// server's clock. `startedAt` is when this window sent the question; `status` and `steps` come from the progress.
const READ_KINDS = new Set(['report', 'asset-folder', 'asset', 'run', 'trend', 'posts', 'find', 'conversation', 'memory', 'prompt', 'spend']);
const STATUS_LABEL = { sending: 'Sending your question', starting: 'Looking at your studio', thinking: 'Thinking', reading: 'Reading', writing: 'Writing', finishing: 'Finishing the answer' };
const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const seconds = (ms) => `${Math.max(1, Math.round(ms / 1000))}s`;

export function stepSummary({ status, steps = [], elapsedMs = 0 }) {
  const reads = steps.filter((step) => READ_KINDS.has(step.kind) && step.status === 'done').length;
  const time = seconds(elapsedMs);
  if (status === 'stopped') return `Stopped after ${time}`;
  if (status === 'failed') return `Didn’t finish · ${time}`;
  if (reads) return `Read ${reads === 1 ? '1 thing' : `${reads} things`} · ${time}`;
  return `Thought for ${time}`;
}
export function currentStep({ status, steps = [] }) {
  const running = [...steps].reverse().find((step) => step.status === 'running' && step.kind !== 'thinking');
  if (running) return running.label;
  if (status === 'writing') return 'Writing';
  return STATUS_LABEL[status] || 'Thinking';
}

// doneLabel: what a finished answer read ("Read “Zero-click report”"), shown in place of the summary.
export function AskSteps({ status = 'sending', steps = [], startedAt = 0, doneLabel = '' }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const listId = useId();
  const began = useRef(startedAt || clock()); const ended = useRef(0);
  const finished = isFinal(status);
  if (finished && !ended.current) ended.current = clock();
  if (!finished && ended.current) ended.current = 0;
  useEffect(() => {
    if (finished) return undefined;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [finished]);
  const elapsed = (ended.current || clock()) - began.current;
  const label = finished ? (status === 'done' && doneLabel ? doneLabel : stepSummary({ status, steps, elapsedMs: elapsed })) : currentStep({ status, steps });
  const shown = steps.filter((step) => step.label);
  return <div className={`ask-steps${finished ? ' is-done' : ' is-live'}${status === 'failed' ? ' is-failed' : ''}${finished && doneLabel ? ' help-read' : ''}`}>
    <div className="ask-steps-line">
      {!finished && <span className="ask-steps-dot" aria-hidden="true" />}
      {shown.length > 0
        ? <button type="button" className="ask-steps-toggle" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
          <span className="ask-steps-label">{label}</span>{!finished && <span className="ask-steps-time"> · {seconds(elapsed)}</span>}<ChevronDown size={13} aria-hidden="true" />
        </button>
        : <span className="ask-steps-label">{label}{!finished && <span className="ask-steps-time"> · {seconds(elapsed)}</span>}</span>}
    </div>
    {open && shown.length > 0 && <ol id={listId} className="ask-steps-list" aria-label="What Ask AI did">
      {shown.map((step) => <li key={step.id} className={`is-${step.status}`}>
        {step.status === 'done' ? <Check size={12} aria-hidden="true" /> : step.status === 'failed' ? <CircleAlert size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        <span>{step.label}</span>{step.status === 'running' && <span className="sr-only"> (in progress)</span>}
      </li>)}
    </ol>}
  </div>;
}

// Three soft dots until the first words arrive; screen readers hear "Ask AI is thinking".
export function AskTypingDots() {
  return <span className="ask-typing" role="img" aria-label="Ask AI is thinking"><i /><i /><i /></span>;
}
