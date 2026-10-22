import { methods } from '../shared/studio-api-channels.json';

// The browser studio renders the same app as the Mac version. Each API method calls the same main-process
// handler on the server (POST /api/rpc). Where the Mac app shows a file dialog, the browser shows its own file
// picker and uploads the file first; files the server saves or "opens" come back as downloads.
export const FILE_PICKERS = {
  importStudioSource: (payload) => (payload?.url ? '' : '.txt,.md,.docx'),
  importWorkbook: () => '.xlsx,.csv,.tsv',
  pickImportFile: () => '.csv,.json,.jsonl,.ndjson',
  openSetupFile: () => '.json',
  addBrandImage: () => '.png,.jpg,.jpeg,.webp',
};

// Which build this tab runs: the hashed bundle names its index.html loaded (studio-server.js buildIdFrom reads the same
// names from the page it serves). Read once at load, before any lazily loaded styles are added.
export function pageBuild(doc = typeof document === 'undefined' ? null : document) {
  if (!doc?.querySelectorAll) return '';
  return [...doc.querySelectorAll('script[type="module"][src], link[rel="stylesheet"][href]')].map((element) => element.getAttribute('src') || element.getAttribute('href') || '').filter((ref) => /\/assets\//.test(ref)).map((ref) => ref.split('/').pop()).join(' ');
}
const PAGE_BUILD = pageBuild();
let updateAnnounced = false;
// After a deploy the server runs a newer build than this tab: offer a reload once (main.jsx shows it).
function noteBuild(build) {
  if (!build || !PAGE_BUILD || build === PAGE_BUILD || updateAnnounced) return;
  updateAnnounced = true; window.dispatchEvent(new CustomEvent('studio-updated', { detail: { build } }));
}
// Live updates paused or back: { live, reason: 'busy' | 'restarting' } (main.jsx shows a quiet notice).
let liveReason = '';
function setLive(live, reason = '') {
  const next = live ? '' : reason; if (next === liveReason) return;
  liveReason = next; window.dispatchEvent(new CustomEvent('studio-live', { detail: { live, reason } }));
}

// Behind company sign-in (an SSO proxy) an expired session is answered by the proxy, not the studio: a redirect to the
// identity provider, its own 401 or an HTML sign-in page. main.jsx sets this once /api/session says so.
let proxySignIn = false;
export const setProxySignIn = (on) => { proxySignIn = Boolean(on); };
export class SignedOut extends Error {}
export async function request(url, init = {}) {
  let response;
  // Accept and X-Requested-With make oauth2-proxy and Cloudflare Access answer an expired session with a 401 rather than
  // a redirect; redirect: 'manual' turns any redirect that's left into a response this code can see (the studio never
  // redirects /api/*), instead of a cross-origin "Failed to fetch".
  try { response = await fetch(url, { credentials: 'same-origin', redirect: 'manual', ...init, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(init.headers || {}) } }); }
  catch (error) { throw Object.assign(new Error('The studio didn’t answer. Check your connection, then try again.'), { status: 0, cause: error }); }
  noteBuild(response.headers?.get?.('x-studio-build') || '');
  const type = response.headers?.get?.('content-type');
  const isJson = type == null || /^application\/json\b/i.test(type);
  const body = isJson ? await response.json().catch(() => ({})) : {};
  const redirected = response.type === 'opaqueredirect';
  if (redirected || response.status === 401 || (proxySignIn && response.status === 403 && !isJson)) {
    const mode = body.signIn || (proxySignIn || redirected ? 'proxy' : 'password');
    window.dispatchEvent(new CustomEvent('studio-signed-out', { detail: mode }));
    throw Object.assign(new SignedOut(body.error || 'Sign in to this studio.'), { mode, status: 401, methods: body.methods || null });
  }
  // status and code (forbidden, preview, editConflict…) stay on the error so screens can tell a refusal from a failure.
  if (!response.ok) {
    if (body.code === 'unknownAction') noteBuild('server-changed'); // this tab calls something the server doesn't have: older JavaScript
    const fallback = !isJson && response.status >= 500 ? 'The studio isn’t answering right now. Try again in a minute.' : `The studio server answered ${response.status}.`;
    throw Object.assign(new Error(body.error || fallback), { status: response.status, ...(body.code ? { code: body.code } : {}), ...(body.ref ? { ref: body.ref } : {}) });
  }
  return body;
}
export const postJson = (url, payload) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

// Opens the browser's file picker. It must start inside the click that called the API method, so this runs
// before anything is awaited. Resolves with no files when the picker is cancelled.
function chooseFiles(accept) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.style.display = 'none'; document.body.appendChild(input);
    let settled = false;
    const done = (files) => { if (settled) return; settled = true; window.removeEventListener('focus', onFocus); input.remove(); resolve(files); };
    // Browsers without the input "cancel" event: when focus returns with nothing chosen, treat it as cancelled.
    const onFocus = () => setTimeout(() => { if (!input.files?.length) done([]); }, 800);
    input.addEventListener('change', () => done([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
async function upload(file) {
  const { uploadId } = await request('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
  return uploadId;
}
function download({ url, fileName }) {
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName || '' });
  document.body.appendChild(link); link.click(); link.remove();
}

async function call(method, channel, payload) {
  const accept = FILE_PICKERS[method]?.(payload) || '';
  const files = accept ? await chooseFiles(accept) : [];
  const uploads = [];
  for (const file of files) uploads.push(await upload(file));
  const response = await postJson('/api/rpc', { channel, payload, uploads });
  response.downloads?.forEach((entry, index) => setTimeout(() => download(entry), index * 400));
  for (const url of response.opens || []) window.open(url, '_blank', 'noopener,noreferrer');
  if (channel === 'state' && stateListeners.size && !events && !hidden()) openEvents(); // e.g. Check again after access was granted
  return response.result;
}

// State pushes arrive over server-sent events; the browser reconnects on its own after a drop. The server ends a
// stream when this tab is signed out or its access changes, so an error checks the session: a 401 there announces the
// sign-out. When the server refused the stream outright (no access), the tab gets fresh state once, which shows the
// change, and the stream reopens the next time the page reads the state. A server at its stream limit says `busy` in
// its hello: the browser asks again every 30 s, and each time this tab fetches the state once, so it falls behind by 30 s
// at most.
const stateListeners = new Set(); let events = null; let parked = false; let retryMs = 0;
const notify = (next) => { for (const fn of stateListeners) fn(next); };
// Ask AI's streamed answers and follow-ups ride the same stream as `event: ask` (only this person's). A stream that
// dropped or stalled can't say what it missed, so its listeners hear { type: 'resync' } and read the answers back.
// Live events for this person (doc-update, doc-presence, note-changed; index.js pushPersonEvent) ride it as `event:
// person`, and hear the same { type: 'resync' }.
const askListeners = new Set(); const personListeners = new Set();
const notifyPerson = (event) => { for (const fn of personListeners) { try { fn(event); } catch { /* one listener never stops the rest */ } } };
const notifyAsk = (event) => { for (const fn of askListeners) { try { fn(event); } catch { /* one listener never stops the rest */ } } if (event?.type === 'resync') notifyPerson(event); };
const listening = () => stateListeners.size > 0 || askListeners.size > 0 || personListeners.size > 0;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const refreshState = () => postJson('/api/rpc', { channel: 'state' }).then(({ result }) => { if (result && stateListeners.size) notify(result); }).catch(() => {});
// catchUp: this stream replaces one that dropped, so its hello also fetches what was missed.
function openEvents(catchUp = false) {
  const source = new EventSource('/api/events'); events = source; let refused = false; let dropped = catchUp;
  // Every stream starts with the server's build and whether it can stream to this tab; after a drop it also means
  // "back", so catch up on what was missed.
  source.addEventListener('hello', (event) => {
    let info = {}; try { info = JSON.parse(event.data); } catch { info = {}; }
    noteBuild(info.build); refused = Boolean(info.busy); retryMs = 0;
    if (info.busy) { setLive(false, 'busy'); refreshState(); }
    else if (info.restarting) setLive(false, 'restarting');
    else { if (dropped) { refreshState(); notifyAsk({ type: 'resync' }); } setLive(true); }
    dropped = false;
  });
  source.addEventListener('state-changed', (event) => { let next; try { next = JSON.parse(event.data); } catch { return; } setLive(true); notify(next); });
  source.addEventListener('ask', (event) => { let next; try { next = JSON.parse(event.data); } catch { return; } if (next && typeof next === 'object') notifyAsk(next); });
  source.addEventListener('ask-resync', () => notifyAsk({ type: 'resync' }));
  source.addEventListener('person', (event) => { let next; try { next = JSON.parse(event.data); } catch { return; } if (next && typeof next === 'object') notifyPerson(next); });
  // The same person opened more tabs than the server streams to, and this is the oldest: stop instead of reconnecting
  // (which would only push out the next one). It opens again the next time this tab reads the state.
  source.addEventListener('replaced', () => { source.close(); if (events === source) events = null; });
  source.addEventListener('restarting', () => setLive(false, 'restarting'));
  source.addEventListener('error', () => {
    dropped = true;
    if (refused) { refused = false; return; } // the server is full: the browser asks again on its own
    request('/api/session').then(async () => {
      if (source.readyState !== EventSource.CLOSED || events !== source) return; // still reconnecting on its own
      events = null;
      const { result } = await postJson('/api/rpc', { channel: 'state' });
      if (result && stateListeners.size) notify(result);
      notifyAsk({ type: 'resync' });
    }).catch((error) => {
      // Signed out: the sign-in screen takes over. Otherwise the server is down or restarting; a proxy's 502 meanwhile
      // closes EventSource for good, so open a new stream shortly, waiting longer each time (up to a minute).
      if (error instanceof SignedOut || source.readyState !== EventSource.CLOSED || events !== source) return;
      retryMs = Math.min(60000, retryMs ? retryMs * 2 : 5000);
      setTimeout(() => { if (events === source && listening()) { events = null; openEvents(true); } }, retryMs);
    });
  });
}
// A tab left in the background gives its stream back after a minute, so open-but-unused tabs don't fill the server's
// slots; it reconnects and catches up when it's shown again.
const HIDDEN_RELEASE_MS = 60000; let hiddenTimer = null;
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (hidden()) {
    if (!hiddenTimer && events) hiddenTimer = setTimeout(() => { hiddenTimer = null; if (hidden() && events) { events.close(); events = null; parked = true; } }, HIDDEN_RELEASE_MS);
    return;
  }
  clearTimeout(hiddenTimer); hiddenTimer = null;
  if (parked) { parked = false; if (listening() && !events) { openEvents(); refreshState(); notifyAsk({ type: 'resync' }); } }
});
function onStateChanged(listener) {
  stateListeners.add(listener);
  if (!events) openEvents();
  return () => { stateListeners.delete(listener); if (!listening() && events) { events.close(); events = null; } };
}
function onAskStream(listener) {
  if (typeof listener !== 'function') return () => {};
  askListeners.add(listener);
  if (!events && !hidden()) openEvents();
  return () => { askListeners.delete(listener); if (!listening() && events) { events.close(); events = null; } };
}
function onPersonEvent(listener) {
  if (typeof listener !== 'function') return () => {};
  personListeners.add(listener);
  if (!events && !hidden()) openEvents();
  return () => { personListeners.delete(listener); if (!listening() && events) { events.close(); events = null; } };
}

export function createWebApi() {
  const api = {};
  for (const [method, entry] of Object.entries(methods)) {
    const channel = typeof entry === 'string' ? entry : entry.channel;
    // Same shapes as the desktop preload: one payload, no payload, or named arguments packed into one object.
    api[method] = typeof entry === 'string' ? (payload) => call(method, channel, payload)
      : !entry.args.length ? () => call(method, channel, undefined)
        : (...args) => call(method, channel, Object.fromEntries(entry.args.map((name, index) => [name, args[index]])));
  }
  api.onStateChanged = onStateChanged;
  api.onAskStream = onAskStream;
  api.onPersonEvent = onPersonEvent;
  api.signOut = async () => { await postJson('/api/logout', {}).catch(() => {}); window.location.reload(); };
  return api;
}
