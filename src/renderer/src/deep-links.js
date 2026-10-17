import { useEffect, useRef } from 'react';

// Share links: #/report/<assetId>, #/trend/<themeId>, #/assets/<sourceKey> and #/prompt/<promptId>. The fragment never
// reaches the server or its logs. App resolves a link after sign-in (useDeepLink), and access still applies: someone
// whose role can't see the target lands on the page with a note, never on the content. On the Mac, links point at the
// browser studio, so Copy link shows only once Settings has a "Studio web address".
export const LINK_KINDS = Object.freeze(['report', 'trend', 'assets', 'prompt']);
// Ids are studio-minted (asset-…, theme-…, theme:<id> source keys, prompt ids): letters, digits and a few separators.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,299}$/;
const STASH = 'studio.deeplink';
const STASH_MS = 30 * 60 * 1000;

// "#/report/asset-1" → { kind: 'report', id: 'asset-1' }; anything else (including #signin=…) → null.
export function parseHash(hash) {
  const match = String(hash || '').match(/^#\/(report|trend|assets|prompt)\/([^/?#]+)\/?$/);
  if (!match) return null;
  let id = '';
  try { id = decodeURIComponent(match[2]).trim(); } catch { return null; }
  return ID.test(id) ? { kind: match[1], id } : null;
}

// "https://studio.example.com/team/" → "https://studio.example.com/team"; only http(s), no credentials, query or hash.
export function normalizeOrigin(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text) || text.length > 500) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return '';
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return '';
    return `${url.origin}${url.pathname.replace(/\/(index\.html)?$/i, '')}`;
  } catch { return ''; }
}

// The full link, or '' when there is no address to build it on.
export function linkFor(kind, id, { origin = '' } = {}) {
  const base = normalizeOrigin(origin);
  if (!base || !LINK_KINDS.includes(kind) || !ID.test(String(id || ''))) return '';
  return `${base}/#/${kind}/${encodeURIComponent(String(id))}`;
}

// The address share links are built on: this page's origin in the browser studio; the saved "Studio web address" on the
// Mac (Settings), or '' when none is saved, which hides Copy link.
export function shareOrigin({ web = false, settings = {}, location = typeof window !== 'undefined' ? window.location : null } = {}) {
  if (web) return normalizeOrigin(location?.origin || '');
  return normalizeOrigin(settings?.studioWebAddress || '');
}

// Opens a share link once the studio has signed in and loaded (enabled), and again whenever the fragment changes while
// it's open. The handler gets { kind, id }; unless it returns false the fragment is cleared, so a reload or a copied
// address bar doesn't open it twice.
export function useDeepLink(handler, { enabled = true } = {}) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const take = () => {
      const link = parseHash(window.location.hash);
      if (!link) return;
      let handled;
      try { handled = ref.current?.(link); } catch { handled = undefined; }
      if (handled === false) return;
      try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); } catch { /* a sandboxed frame can refuse */ }
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, [enabled]);
}

// A share link opened while signed out survives the sign-in (the browser studio): kept for 30 minutes in this browser,
// then put back in the address bar once the studio is ready. A per-browser convenience only.
export function stashDeepLink(hash = typeof window !== 'undefined' ? window.location.hash : '', storage = safeStorage(), now = Date.now()) {
  const link = parseHash(hash);
  if (!link || !storage) return null;
  try { storage.setItem(STASH, JSON.stringify({ ...link, at: now })); } catch { return null; }
  return link;
}
export function takeStashedDeepLink(storage = safeStorage(), now = Date.now()) {
  if (!storage) return null;
  let saved = null;
  try { saved = JSON.parse(storage.getItem(STASH) || 'null'); storage.removeItem(STASH); } catch { return null; }
  if (!saved || !LINK_KINDS.includes(saved.kind) || !ID.test(String(saved.id || '')) || !(now - Number(saved.at) < STASH_MS) || Number(saved.at) > now + 60000) return null;
  return { kind: saved.kind, id: saved.id };
}
// Puts a stashed link back as the fragment unless the address already has one.
export function restoreDeepLink(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  const storage = safeStorage(win);
  if (parseHash(win.location.hash)) { try { storage?.removeItem(STASH); } catch { /* storage blocked */ } return null; }
  const link = takeStashedDeepLink(storage);
  if (!link) return null;
  try { win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}#/${link.kind}/${encodeURIComponent(link.id)}`); } catch { return null; }
  return link;
}
function safeStorage(win = typeof window !== 'undefined' ? window : null) {
  try { return win?.localStorage || null; } catch { return null; }
}

// A share link as the target the briefing and Inbox use (onOpenTarget): a report, a trend, an Assets folder (by its
// sourceKey) or a prompt.
export function deepLinkTarget(link) {
  if (!link || !LINK_KINDS.includes(link.kind)) return null;
  return { report: { kind: 'report', id: link.id, page: 'reports' }, trend: { kind: 'trend', id: link.id, page: 'trends' }, assets: { kind: 'folder', id: link.id, page: 'assets' }, prompt: { kind: 'prompt', id: link.id, page: 'prompts' } }[link.kind];
}

// Plain words for the toast after Copy link.
export const LINK_COPIED = 'Link copied. People signed in to the studio can open it.';
