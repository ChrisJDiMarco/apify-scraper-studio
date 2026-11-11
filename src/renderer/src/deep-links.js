import { useEffect, useRef } from 'react';

// Share links: #/report/<assetId>, #/trend/<themeId>, #/assets/<sourceKey>, #/prompt/<promptId> and
// #/settings/<section> (also #settings/<section>; the section may be left out). The fragment never reaches the server or
// its logs. App resolves a link after sign-in (useDeepLink), and access still applies: someone whose role can't see the
// target lands on the page with a note, never on the content. On the Mac, links point at the browser studio, so Copy
// link shows only once Settings has a "Studio web address".
export const LINK_KINDS = Object.freeze(['report', 'trend', 'assets', 'prompt', 'settings']);
// Ids are studio-minted (asset-…, theme-…, theme:<id> source keys, prompt ids): letters, digits and a few separators.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,299}$/;
// Settings section ids (settings-sections.js): lowercase words and dashes; '' opens Settings at the top.
const SECTION = /^[a-z0-9-]{0,40}$/;
const validId = (kind, id) => (kind === 'settings' ? SECTION.test(String(id ?? '')) : ID.test(String(id || '')));
const hashFor = (kind, id) => (kind === 'settings' && !id ? '#/settings' : `#/${kind}/${encodeURIComponent(id)}`);
const STASH = 'studio.deeplink';
const STASH_MS = 30 * 60 * 1000;

// "#/report/asset-1" → { kind: 'report', id: 'asset-1' }; anything else (including #signin=…) → null.
export function parseHash(hash) {
  const settings = String(hash || '').match(/^#\/?settings(?:\/([a-z0-9-]{1,40}))?\/?$/);
  if (settings) return { kind: 'settings', id: settings[1] || '' };
  const trend = parseTrend(hash);
  if (trend) return trend;
  const match = String(hash || '').match(/^#\/(report|trend|assets|prompt)\/([^/?#]+)\/?$/);
  if (!match) return null;
  let id = '';
  try { id = decodeURIComponent(match[2]).trim(); } catch { return null; }
  return ID.test(id) ? { kind: match[1], id } : null;
}

// A trend's page: #/trend/<themeId>, #/trend/<themeId>/<tab> and ?run=<researchRunId> (a recurring trend has a card in
// every run that found it). { kind: 'trend', id, tab?, run? }. A bare #/trend/<id> is the share link people already
// have: it has neither, and opens the trend where it can be acted on (its report when it has one, else Trends).
export const TREND_TABS = Object.freeze(['overview', 'report', 'toolkit', 'assets']);
function parseTrend(hash) {
  const match = String(hash || '').match(/^#\/trend\/([^/?#]+)(?:\/([a-z]+))?\/?(?:\?([^#]*))?$/);
  if (!match || (!match[2] && match[3] === undefined)) return null;
  let id = ''; let run = '';
  try { id = decodeURIComponent(match[1]).trim(); run = new URLSearchParams(match[3] || '').get('run') || ''; } catch { return null; }
  if (!ID.test(id) || (match[2] && !TREND_TABS.includes(match[2]))) return null;
  return { kind: 'trend', id, ...(match[2] ? { tab: match[2] } : {}), ...(run && ID.test(run) ? { run } : {}) };
}
const trendHash = (route) => `#/trend/${encodeURIComponent(route.id)}${route.tab && TREND_TABS.includes(route.tab) ? `/${route.tab}` : ''}${route.run && ID.test(route.run) ? `?run=${encodeURIComponent(route.run)}` : ''}`;

// Page addresses: every page has one, and App keeps it in the address bar as people move (useRoutes), so a link to any
// page can be sent and Back and Forward move between pages. { kind: 'page', page, id?, section?, program? }:
//   #/home · #/programs · #/programs/<programId> (its runs) · #/programs/<programId>/edit/<section> · #/trends
//   (#/trends?program=<programId>) · #/assets · #/calendar · #/inbox · #/ask · #/plan (a channel owner's)
//   #/studio/<prompts|channels|analytics|people|knowledge> · #/mychannel (a channel owner's) · #/workbench/<pageId> (search, automation, create, sheets…)
// The share links above are routes too (a report, a trend, an Assets folder, a prompt, a Settings section).
export const PAGE_ROUTES = Object.freeze(['home', 'programs', 'trends', 'assets', 'calendar', 'inbox', 'ask', 'plan', 'mychannel']);
const STUDIO_ROUTES = new Set(['prompts', 'channels', 'analytics', 'people', 'knowledge']);
const PAGE_ID = /^[a-z][a-z0-9-]{0,40}$/;
export function parseRoute(hash) {
  const link = parseHash(hash);
  if (link) return link;
  const match = String(hash || '').match(/^#\/([a-z]+)(?:\/([^?#]*))?(?:\?([^#]*))?$/);
  if (!match) return null;
  const [, head, rest = '', query = ''] = match;
  let parts;
  try { parts = rest.split('/').filter(Boolean).map((part) => decodeURIComponent(part).trim()); } catch { return null; }
  if (head === 'programs') {
    if (!parts.length) return { kind: 'page', page: 'programs' };
    if (!ID.test(parts[0])) return null;
    if (parts.length === 1) return { kind: 'page', page: 'program', id: parts[0], section: '' };
    const section = parts[2] || 'basics';
    return parts[1] === 'edit' && parts.length <= 3 && PAGE_ID.test(section) ? { kind: 'page', page: 'program', id: parts[0], section } : null;
  }
  if (head === 'studio') return parts.length === 1 && STUDIO_ROUTES.has(parts[0]) ? { kind: 'page', page: parts[0] } : null;
  if (head === 'workbench') return parts.length === 1 && PAGE_ID.test(parts[0]) ? { kind: 'page', page: 'workbench', id: parts[0] } : null;
  if (!PAGE_ROUTES.includes(head) || parts.length) return null;
  let program = '';
  try { program = head === 'trends' ? new URLSearchParams(query).get('program') || '' : ''; } catch { program = ''; }
  return { kind: 'page', page: head, ...(program && ID.test(program) ? { program } : {}) };
}
// The address for a route, '' when it has none.
export function hashForRoute(route) {
  if (!route?.kind) return '';
  if (route.kind === 'trend') return ID.test(String(route.id || '')) ? trendHash(route) : '';
  if (route.kind !== 'page') return LINK_KINDS.includes(route.kind) && validId(route.kind, route.id) ? hashFor(route.kind, route.id ?? '') : '';
  const id = String(route.id || '');
  if (route.page === 'program') return ID.test(id) ? (route.section && PAGE_ID.test(route.section) ? `#/programs/${encodeURIComponent(id)}/edit/${route.section}` : `#/programs/${encodeURIComponent(id)}`) : '#/programs';
  if (STUDIO_ROUTES.has(route.page)) return `#/studio/${route.page}`;
  if (route.page === 'workbench') return PAGE_ID.test(id) ? `#/workbench/${id}` : '';
  if (route.page === 'trends' && route.program && ID.test(route.program)) return `#/trends?program=${encodeURIComponent(route.program)}`;
  return PAGE_ROUTES.includes(route.page) ? `#/${route.page}` : '';
}
// The full link for a route, as linkFor builds a share link.
export function routeLink(route, { origin = '' } = {}) {
  const base = normalizeOrigin(origin); const hash = hashForRoute(route);
  return base && hash ? `${base}/${hash}` : '';
}

// Keeps the address bar and the page in step, once the studio is ready (`enabled`): the address it opened on (a link,
// a reload) and every Back, Forward or edited address open that page (`onOpen(route)`); every page shown afterwards
// (`current`, its hash) becomes a new history entry. After an address is opened, the address bar waits for the page to
// arrive and then shows where it landed (a trend link names the report it opened), replacing the entry rather than
// adding one, so Back never bounces.
export function useRoutes({ enabled = true, current = '', onOpen }) {
  const open = useRef(onOpen); open.current = onOpen;
  const latest = useRef(current); latest.current = current;
  const shown = useRef(''); // the address the studio last wrote or opened
  const held = useRef(null); // { from }: an address being opened; the bar waits until the page leaves `from`
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const take = () => {
      const hash = window.location.hash || '';
      if (!hash || hash === shown.current) return;
      const route = parseRoute(hash);
      if (!route) return;
      shown.current = hash; held.current = { from: latest.current, at: Date.now() };
      try { open.current?.(route); } catch { /* the page says what went wrong */ }
    };
    take();
    window.addEventListener('hashchange', take);
    window.addEventListener('popstate', take);
    return () => { window.removeEventListener('hashchange', take); window.removeEventListener('popstate', take); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !current || typeof window === 'undefined') return;
    const hold = held.current;
    // Still on the page that was showing when an address was opened (it may take a frame to arrive): leave the bar.
    if (hold && current === hold.from && Date.now() - hold.at < 2000) return;
    held.current = null;
    if (window.location.hash === current) { shown.current = current; return; }
    const url = `${window.location.pathname}${window.location.search}${current}`;
    try { window.history[hold || !shown.current ? 'replaceState' : 'pushState'](null, '', url); } catch { /* a sandboxed frame can refuse */ }
    shown.current = current;
  }, [enabled, current]);
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
  if (!base || !LINK_KINDS.includes(kind) || !validId(kind, id)) return '';
  return `${base}/${hashFor(kind, String(id ?? ''))}`;
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
// Any page's address counts (a link to Trends or a program's editor survives sign-in as a report link does).
export function stashDeepLink(hash = typeof window !== 'undefined' ? window.location.hash : '', storage = safeStorage(), now = Date.now()) {
  const link = parseRoute(hash);
  if (!link || !storage) return null;
  try { storage.setItem(STASH, JSON.stringify({ hash: hashForRoute(link), at: now })); } catch { return null; }
  return link;
}
export function takeStashedDeepLink(storage = safeStorage(), now = Date.now()) {
  if (!storage) return null;
  let saved = null;
  try { saved = JSON.parse(storage.getItem(STASH) || 'null'); storage.removeItem(STASH); } catch { return null; }
  if (!saved || !(now - Number(saved.at) < STASH_MS) || Number(saved.at) > now + 60000) return null;
  // Older stashes held { kind, id }: still honoured.
  const link = typeof saved.hash === 'string' ? parseRoute(saved.hash) : LINK_KINDS.includes(saved.kind) && validId(saved.kind, saved.id) ? { kind: saved.kind, id: String(saved.id ?? '') } : null;
  return link || null;
}
// Puts a stashed link back as the fragment unless the address already has one.
export function restoreDeepLink(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  const storage = safeStorage(win);
  if (parseRoute(win.location.hash)) { try { storage?.removeItem(STASH); } catch { /* storage blocked */ } return null; }
  const link = takeStashedDeepLink(storage);
  if (!link) return null;
  try { win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}${hashForRoute(link)}`); } catch { return null; }
  return link;
}
function safeStorage(win = typeof window !== 'undefined' ? window : null) {
  try { return win?.localStorage || null; } catch { return null; }
}

// A share link as the target the briefing and Inbox use (onOpenTarget): a report, a trend, an Assets folder (by its
// sourceKey), a prompt or a Settings section.
export function deepLinkTarget(link) {
  if (!link || !LINK_KINDS.includes(link.kind)) return null;
  return { report: { kind: 'report', id: link.id, page: 'trends' }, trend: { kind: 'trend', id: link.id, page: 'trends', ...(link.tab ? { tab: link.tab } : {}), ...(link.run ? { runId: link.run } : {}) }, assets: { kind: 'folder', id: link.id, page: 'assets' }, prompt: { kind: 'prompt', id: link.id, page: 'prompts' }, settings: { kind: 'page', page: 'settings', section: link.id || '' } }[link.kind];
}

// Plain words for the toast after Copy link.
export const LINK_COPIED = 'Link copied. People signed in to the studio can open it.';
