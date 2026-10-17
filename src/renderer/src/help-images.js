import { useEffect, useMemo, useState } from 'react';

// Pictures made in Ask AI, for the Library and Simple's Assets. Neither page remounts while the Ask AI drawer (or
// Simple's Ask AI page, which stays mounted) draws a picture, and no state push carries pictures, so whoever creates
// one announces it and every list reads again. One renderer serves a window, so a window event reaches both layouts.
const EVENT = 'studio:help-images-changed';
export const announceHelpImages = () => { try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window (tests in node) */ } };

// `initial` is what shows before the first answer (null keeps a loading skeleton). A failed refresh keeps the rows
// already shown; an older reply that lands late is dropped.
export function useHelpImages(api, initial = []) {
  const [rows, setRows] = useState(initial);
  const lister = typeof api?.listHelpImages === 'function' ? api.listHelpImages : null;
  useEffect(() => {
    if (!lister) { setRows([]); return undefined; }
    let live = true; let seq = 0;
    const load = () => {
      const mine = ++seq;
      Promise.resolve().then(() => lister()).then((result) => { if (live && mine === seq) setRows(Array.isArray(result) ? result : []); }, () => { if (live && mine === seq) setRows((current) => current ?? []); });
    };
    load(); window.addEventListener(EVENT, load);
    return () => { live = false; window.removeEventListener(EVENT, load); };
  }, [lister]);
  return rows;
}

// The api Ask AI is given: the same methods, with createHelpImage announcing each new picture once it is saved, so the
// layouts never thread a "picture made" callback through the assistant.
export function useAnnouncingApi(api) {
  return useMemo(() => {
    if (!api || typeof api.createHelpImage !== 'function') return api;
    return { ...api, createHelpImage: async (...args) => { const made = await api.createHelpImage(...args); announceHelpImages(); return made; } };
  }, [api]);
}
