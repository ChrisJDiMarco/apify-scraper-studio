import { useCallback, useEffect, useRef, useState } from 'react';

// Scroll-spy for long pages with a section list beside them (the Settings nav, the program drawer's jump chips).
// It never writes the URL: a stale #/settings/<section> would reopen Settings on reload.

// The nearest ancestor that scrolls (overflow-y auto or scroll), or null when the page itself scrolls.
export function scrollParent(node) {
  if (typeof window === 'undefined') return null;
  let current = node?.parentElement || null;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY || '') && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

const reducedMotion = () => Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// Scrolls `el` to the top of its scroll area, opens it when it is a <details> (or holds one first), and with `focus`
// moves keyboard focus to its heading, so a screen reader announces where the jump landed.
export function revealSection(el, { smooth = true, focus = false } = {}) {
  if (!el) return;
  const details = el.tagName === 'DETAILS' ? el : [...el.children].find((child) => child.tagName === 'DETAILS');
  if (details && !details.open) details.open = true;
  el.scrollIntoView?.({ block: 'start', behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  if (!focus) return;
  const target = el.querySelector('h2, h3, summary');
  if (!target) return;
  if (/^H\d$/.test(target.tagName) && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus?.({ preventScroll: true });
}

// { active, setActive, lock(id) }: `active` is the first section whose top has crossed into the upper part of the
// scroll area (or the last one at the very bottom, so a short last section still lights up). lock(id) holds `active` on
// a section the person just jumped to until that scroll ends, so the highlight doesn't flicker through the ones between.
// Without IntersectionObserver (jsdom) `active` stays where it was set, else the first id.
export function useSectionSpy({ ids = [], getElement = (id) => document.getElementById(`settings-${id}`), offset = 24, enabled = true } = {}) {
  const [active, setActiveState] = useState(ids[0] || '');
  const activeRef = useRef(active);
  const locked = useRef(null);
  const getRef = useRef(getElement); getRef.current = getElement;
  const setActive = useCallback((id) => { activeRef.current = id; setActiveState(id); }, []);
  const key = ids.join('|');
  useEffect(() => { if (!ids.includes(activeRef.current)) setActive(ids[0] || ''); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = useCallback((id) => {
    setActive(id);
    clearTimeout(locked.current?.timer);
    const release = () => { clearTimeout(locked.current?.timer); locked.current?.root?.removeEventListener?.('scrollend', release); locked.current = null; };
    const first = getRef.current(id);
    const root = first ? scrollParent(first) || window : null;
    locked.current = { id, root, timer: setTimeout(release, 800) };
    root?.addEventListener?.('scrollend', release, { once: true });
  }, [setActive]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function' || !ids.length) return undefined;
    const elements = ids.map((id) => [id, getRef.current(id)]).filter(([, el]) => el);
    if (!elements.length) return undefined;
    const rootEl = scrollParent(elements[0][1]);
    const visible = new Set();
    const pick = () => {
      if (locked.current) return;
      const first = ids.find((id) => visible.has(id));
      if (first && first !== activeRef.current) setActive(first);
    };
    const observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = elements.find(([, el]) => el === entry.target)?.[0];
        if (!id) continue;
        if (entry.isIntersecting) visible.add(id); else visible.delete(id);
      }
      pick();
    }, { root: rootEl, rootMargin: `-${offset}px 0px -60% 0px`, threshold: [0] });
    elements.forEach(([, el]) => observer.observe(el));
    // At the very bottom the last section is the active one, however short it is.
    let frame = 0;
    const target = rootEl || window;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (locked.current) return;
        const scroller = rootEl || document.scrollingElement || document.documentElement;
        if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          const last = elements[elements.length - 1][0];
          if (last !== activeRef.current) setActive(last);
        }
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); target.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [key, enabled, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(locked.current?.timer), []);
  return { active, setActive, lock };
}
