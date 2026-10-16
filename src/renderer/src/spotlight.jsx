import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageCircle, X } from 'lucide-react';
import { spots } from '../../shared/help-spots.json';

// "Show me" from Ask AI: each step moves to its place, finds the control and rings it with a soft spotlight, with
// the step's note beside it. The page stays usable underneath, so the person can click the highlighted control,
// which moves the tour on. Spots are listed in src/shared/help-spots.json.
const SPOTS = new Map(spots.map((spot) => [spot.id, spot]));
const norm = (value) => String(value || '').trim().toLowerCase();
export const spotFor = (id) => SPOTS.get(id) || null;
function locate(step) {
  const spot = SPOTS.get(step.target); if (!spot) return null;
  // Visible matches first; hidden ones only when nothing has a box yet (a closed section, or no layout at all).
  const all = [...document.querySelectorAll(spot.selector || `[data-spot="${spot.id}"]`)];
  // A closed sidebar drawer keeps its layout but is visibility: hidden, so it doesn't count as shown.
  const shown = all.filter((node) => node.getClientRects().length && window.getComputedStyle?.(node).visibility !== 'hidden'); const nodes = shown.length ? shown : all;
  if (spot.item === 'match' && step.item) {
    const item = norm(step.item); const named = (node) => norm(node.dataset.spotItem);
    return nodes.find((node) => named(node) === item) || nodes.find((node) => named(node) && (named(node).includes(item) || item.includes(named(node)))) || null;
  }
  return nodes[0] || null;
}
async function waitFor(find, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const found = find(); if (found) return found; await new Promise((resolve) => setTimeout(resolve, 80)); }
  return find();
}
const typing = (node) => Boolean(node?.closest?.('input, textarea, select, [contenteditable="true"]'));

export function Spotlight({ steps, onPrepare, onClose, onBackToChat }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [missing, setMissing] = useState(false);
  const target = useRef(null);
  const step = steps[index];
  const last = index === steps.length - 1;
  const next = () => { if (last) onClose(); else setIndex((value) => Math.min(steps.length - 1, value + 1)); };
  const back = () => setIndex((value) => Math.max(0, value - 1));
  useEffect(() => {
    let cancelled = false; let clicked = null; target.current = null; setRect(null); setMissing(false);
    (async () => {
      await onPrepare?.(step);
      const node = await waitFor(() => locate(step), 2500);
      if (cancelled) return;
      if (!node) { setMissing(true); return; }
      const details = node.tagName === 'DETAILS' ? node : node.closest('details'); if (details && !details.open) details.open = true;
      node.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      target.current = node;
      // Clicking the highlighted control (not typing into it) is the person doing the step.
      if (!typing(node) && !node.querySelector?.('input, textarea, select')) { clicked = () => setTimeout(() => { if (!cancelled) next(); }, 200); node.addEventListener('click', clicked, { once: true }); }
    })();
    return () => { cancelled = true; if (clicked && target.current) target.current.removeEventListener('click', clicked); };
  }, [index, steps]);
  // Follow the control while the page scrolls, animates or resizes.
  useEffect(() => {
    let frame;
    const tick = () => {
      const node = target.current;
      if (node?.isConnected) { const box = node.getBoundingClientRect(); setRect((current) => (current && Math.abs(current.top - box.top) < 0.5 && Math.abs(current.left - box.left) < 0.5 && Math.abs(current.width - box.width) < 0.5 && Math.abs(current.height - box.height) < 0.5 ? current : { top: box.top, left: box.left, width: box.width, height: box.height })); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (!typing(event.target) && event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); next(); }
      else if (!typing(event.target) && event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, steps.length]);
  // The note sits below the control when there is room, otherwise above it; centered when there is nothing to ring.
  const pad = 8; const width = 330;
  const card = rect ? (() => {
    const below = rect.top + rect.height + pad + 12;
    const top = window.innerHeight - below > 180 ? below : Math.max(12, rect.top - pad - 12 - 172);
    return { top, left: Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12), width };
  })() : null;
  if (!step) return null;
  return <div className="spot-layer">
    {rect ? <div className="spot-ring" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden="true" /> : <div className="spot-dim" aria-hidden="true" />}
    <div className={`spot-card${card ? '' : ' centered'}`} role="dialog" aria-label="Ask AI is showing you" style={card || undefined}>
      <div className="spot-card-head"><small>{steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : 'Ask AI'}</small><button type="button" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      <p aria-live="polite">{missing ? `${step.say} It isn’t on screen right now, so I can’t point at it.` : step.say}</p>
      <div className="spot-card-actions">
        {onBackToChat ? <button type="button" className="spot-quiet" onClick={onBackToChat}><MessageCircle size={14} aria-hidden="true" />Back to chat</button> : <span />}
        <span className="spot-card-nav">
          {index > 0 && <button type="button" className="spot-quiet" aria-label="Previous step" onClick={back}><ArrowLeft size={14} aria-hidden="true" /></button>}
          <button type="button" className="spot-next" onClick={next}>{last ? <><Check size={14} aria-hidden="true" />Done</> : <>Next<ArrowRight size={14} aria-hidden="true" /></>}</button>
        </span>
      </div>
    </div>
  </div>;
}
