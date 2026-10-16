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

export class SignedOut extends Error {}
export async function request(url, init = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { window.dispatchEvent(new CustomEvent('studio-signed-out', { detail: body.signIn })); throw Object.assign(new SignedOut(body.error || 'Sign in to this studio.'), { mode: body.signIn, status: 401 }); }
  // status and code (forbidden, preview, editConflict…) stay on the error so screens can tell a refusal from a failure.
  if (!response.ok) throw Object.assign(new Error(body.error || `The studio server answered ${response.status}.`), { status: response.status, ...(body.code ? { code: body.code } : {}) });
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
  if (channel === 'state' && stateListeners.size && !events) openEvents(); // e.g. Check again after access was granted
  return response.result;
}

// State pushes arrive over server-sent events; the browser reconnects on its own after a drop. The server ends a
// stream when this tab is signed out or its access changes, so an error checks the session: a 401 there announces the
// sign-out. When the server refused the stream outright (no access), the tab gets fresh state once, which shows the
// change, and the stream reopens the next time the page reads the state.
const stateListeners = new Set(); let events = null;
const notify = (next) => { for (const fn of stateListeners) fn(next); };
function openEvents() {
  const source = new EventSource('/api/events'); events = source;
  source.addEventListener('state-changed', (event) => { let next; try { next = JSON.parse(event.data); } catch { return; } notify(next); });
  // The same person opened more tabs than the server streams to, and this is the oldest: stop instead of reconnecting
  // (which would only push out the next one). It opens again the next time this tab reads the state.
  source.addEventListener('replaced', () => { source.close(); if (events === source) events = null; });
  source.addEventListener('error', () => {
    request('/api/session').then(async () => {
      if (source.readyState !== EventSource.CLOSED || events !== source) return; // still reconnecting on its own
      events = null;
      const { result } = await postJson('/api/rpc', { channel: 'state' });
      if (result && stateListeners.size) notify(result);
    }).catch(() => {}); // offline or signed out: the browser retries, or the sign-in screen takes over
  });
}
function onStateChanged(listener) {
  stateListeners.add(listener);
  if (!events) openEvents();
  return () => { stateListeners.delete(listener); if (!stateListeners.size && events) { events.close(); events = null; } };
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
  api.signOut = async () => { await postJson('/api/logout', {}).catch(() => {}); window.location.reload(); };
  return api;
}
