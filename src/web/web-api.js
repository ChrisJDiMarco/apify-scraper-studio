import { methods } from '../shared/studio-api-channels.json';

// The browser studio renders the same app as the Mac version. Each API method calls the same main-process
// handler on the server (POST /api/rpc). Where the Mac app shows a file dialog, the browser shows its own file
// picker and uploads the file first; files the server saves or "opens" come back as downloads.
export const FILE_PICKERS = {
  importStudioSource: (payload) => (payload?.url ? '' : '.txt,.md,.docx'),
  importWorkbook: () => '.xlsx,.csv,.tsv',
  pickImportFile: () => '.csv,.json,.jsonl,.ndjson',
  openSetupFile: () => '.json',
};

export class SignedOut extends Error {}
export async function request(url, init = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { window.dispatchEvent(new CustomEvent('studio-signed-out', { detail: body.signIn })); throw Object.assign(new SignedOut(body.error || 'Sign in to this studio.'), { mode: body.signIn }); }
  if (!response.ok) throw Object.assign(new Error(body.error || `The studio server answered ${response.status}.`), { status: response.status });
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
  return response.result;
}

// State pushes arrive over server-sent events; the browser reconnects on its own after a drop.
const stateListeners = new Set(); let events = null;
function onStateChanged(listener) {
  stateListeners.add(listener);
  if (!events) {
    events = new EventSource('/api/events');
    events.addEventListener('state-changed', (event) => { let next; try { next = JSON.parse(event.data); } catch { return; } for (const fn of stateListeners) fn(next); });
  }
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
