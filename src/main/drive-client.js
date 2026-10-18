'use strict';
// Google Drive for the admin folder sync (drive-sync.js; HANDOFF.md → Google Drive folder sync). Two ways in:
//   - a Google service account: its JSON key signs an RS256 JWT with node:crypto, exchanged at Google's token endpoint
//     for an hour-long access token (cached until a minute before it expires). No npm dependency.
//   - the Google Docs access token an admin pasted (the older route; it expires after about an hour).
// Drive v3 over fetch with supportsAllDrives=true, so a folder in a shared drive works. 429 and 5xx answers (and
// Drive's rate-limit 403s) are retried with backoff, except that a create is never re-sent after a 5xx or a lost answer
// (`once`); every failure becomes one plain sentence (`friendly`).
const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token'; // fixed: a key file's own token_uri is never trusted
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const MAX_KEY_CHARS = 8000;
const MAX_RESPONSE_CHARS = 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Drive's multipart upload limit
const FILE_FIELDS = 'id,name,mimeType,parents,driveId,trashed,webViewLink,appProperties';

const b64url = (value) => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function problem(message, code, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }

// A pasted service account key → the five fields the studio keeps. Anything else in the file is dropped.
function parseServiceAccount(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) throw problem('Paste the service account’s JSON key.', 'driveKeyMissing', { status: 400 });
  if (raw.length > MAX_KEY_CHARS) throw problem('That file is too long to be a service account key. Paste the JSON key Google downloaded.', 'driveKeyInvalid', { status: 400 });
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw problem('That isn’t a JSON key. In Google Cloud, open the service account → Keys → Add key → JSON, and paste the whole file.', 'driveKeyInvalid', { status: 400 }); }
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'service_account') throw problem('That JSON isn’t a service account key (its "type" should be "service_account").', 'driveKeyInvalid', { status: 400 });
  const email = String(parsed.client_email || '').trim();
  if (!/^[^@\s]{1,200}@[a-z0-9.-]{1,200}\.gserviceaccount\.com$/i.test(email)) throw problem('The key has no service account email (client_email).', 'driveKeyInvalid', { status: 400 });
  const pem = String(parsed.private_key || '');
  let keyObject;
  try { keyObject = crypto.createPrivateKey(pem); } catch (_) { throw problem('The key’s private_key can’t be read. Create a new JSON key and paste it again.', 'driveKeyInvalid', { status: 400 }); }
  if (keyObject.asymmetricKeyType !== 'rsa') throw problem('The key’s private_key isn’t an RSA key. Create a new JSON key in Google Cloud.', 'driveKeyInvalid', { status: 400 });
  const clip = (value, max) => String(value || '').slice(0, max);
  return { type: 'service_account', client_email: email, private_key: pem, private_key_id: clip(parsed.private_key_id, 100), project_id: clip(parsed.project_id, 100) };
}

// The signed assertion Google's token endpoint takes (RFC 7523): RS256, an hour long, Drive scope.
function signJwt(key, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(body).end().sign(key.private_key);
  return `${body}.${b64url(signature)}`;
}

async function readJson(response) {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw problem('Google sent back more than expected.', 'driveBadResponse');
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return { raw: text.slice(0, 500) }; }
}

// Access tokens for one service account key, cached until a minute before they expire. `refresh()` drops the cache
// (after a 401). Concurrent callers share one exchange.
function createServiceAccountAuth({ key, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!key?.client_email || !key?.private_key) throw problem('Connect a service account key first.', 'driveKeyMissing');
  let cached = null; let pending = null;
  async function exchange() {
    let response;
    try {
      response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(key, now()) }).toString(), redirect: 'error' });
    } catch (_) { throw problem('Google couldn’t be reached to sign in the service account. Check the internet connection and try again.', 'driveNetwork', { retryable: true }); }
    const body = await readJson(response);
    if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
      const reason = String(body.error || '');
      if (response.status >= 500 || response.status === 429) throw problem('Google’s sign-in service is busy. Try again in a minute.', 'driveBusy', { retryable: true, httpStatus: response.status });
      if (reason === 'invalid_grant') throw problem('Google didn’t accept this service account key. It may have been deleted or disabled in Google Cloud, or this computer’s clock is wrong. Create a new key and paste it.', 'driveKeyRejected', { httpStatus: response.status });
      throw problem('Google didn’t accept this service account key. Create a new JSON key in Google Cloud and paste it.', 'driveKeyRejected', { httpStatus: response.status });
    }
    const seconds = Math.max(60, Math.min(Number(body.expires_in) || 3600, 3600));
    cached = { token: body.access_token, expiresAt: now() + (seconds - 60) * 1000 };
    return cached.token;
  }
  return {
    email: key.client_email,
    async token() {
      if (cached && cached.expiresAt > now()) return cached.token;
      if (!pending) pending = exchange().finally(() => { pending = null; });
      return pending;
    },
    refresh() { cached = null; },
  };
}

// Drive's error answer → one plain sentence. `who` is the service account email (or '' on the token route).
function friendly(status, body, who = '') {
  const errors = Array.isArray(body?.error?.errors) ? body.error.errors : [];
  const reasons = new Set([...errors.map((row) => String(row?.reason || '')), ...(Array.isArray(body?.error?.details) ? body.error.details.map((row) => String(row?.reason || '')) : [])]);
  const text = String(body?.error?.message || '');
  const share = who ? `Share the folder with ${who} as Editor (in a shared drive: Contributor or higher)` : 'Make sure the Google account behind the access token can edit the folder';
  if (status === 401) return { code: 'driveAuth', message: who ? 'Google didn’t accept the service account’s sign-in. Press Test; if it keeps failing, paste a new key.' : 'The Google access token was refused or has expired. Paste a new one, or connect a service account (it doesn’t expire).' };
  if (reasons.has('storageQuotaExceeded') || /storage quota/i.test(text)) return { code: 'driveQuota', message: 'Google says there’s no Drive storage left for these files. A service account has no storage of its own: use a folder in a shared drive, or free up space in the owner’s Drive.' };
  if (reasons.has('accessNotConfigured') || reasons.has('SERVICE_DISABLED') || /has not been used|is disabled/i.test(text)) return { code: 'driveApiOff', message: 'The Google Drive API is turned off for the service account’s Google Cloud project. Turn it on (APIs & Services → Library → Google Drive API), then press Test.' };
  if ([...reasons].some((reason) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(reason)) || status === 429) return { code: 'driveRate', message: 'Google Drive is limiting requests right now. The studio tries again by itself; use Retry in the sync log if it still fails.', retryable: true };
  if (status === 404) return { code: 'driveNotFound', message: `The studio can’t see that folder or file. ${share}, and check the link.` };
  if (status === 403) return { code: 'driveForbidden', message: reasons.has('insufficientFilePermissions') || reasons.has('forbidden') ? `The studio can see the folder but can’t add files to it. ${share}, not Viewer or Commenter.` : `Google Drive refused the request. ${share}.` };
  if (status >= 500) return { code: 'driveBusy', message: 'Google Drive had a problem on its side. The studio tries again by itself; use Retry in the sync log if it still fails.', retryable: true };
  return { code: 'driveFailed', message: `Google Drive didn’t accept the request (status ${status}).` };
}

// Drive v3. getToken() → an access token; refresh() (optional) drops a cached one after a 401, which is retried once.
function createDriveClient({ getToken, refresh = () => {}, who = '', fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); }), retries = 4, timeoutMs = 45000 } = {}) {
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') throw problem('Google Drive needs a sign-in and an HTTP client.', 'driveSetup');
  // `once`: a create (POST). After a 5xx or no answer Drive may already have made the file, so it is never sent twice
  // here; the caller's next attempt looks for the tagged copy first. A 429 or rate-limit 403 was refused, so it retries.
  async function request(route, { method = 'GET', body, contentType, signal, once = false } = {}) {
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw problem('Stopped.', 'driveCancelled');
      const token = await getToken();
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw problem('Connect Google Drive in Settings first.', 'driveAuth');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
      const stop = () => controller.abort(); signal?.addEventListener?.('abort', stop, { once: true });
      let response; let failure = null;
      try {
        response = await fetchImpl(`${API}${route}`, { method, headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json', ...(contentType ? { 'Content-Type': contentType } : {}) }, body, redirect: 'error', signal: controller.signal });
      } catch (_) {
        failure = signal?.aborted ? problem('Stopped.', 'driveCancelled') : problem(controller.signal.aborted ? 'Google Drive took too long to answer. The studio tries again by itself.' : 'Google Drive couldn’t be reached. Check the internet connection; the studio tries again by itself.', 'driveNetwork', { retryable: true });
      } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); }
      if (failure) {
        if (failure.code === 'driveCancelled' || once || attempt >= retries - 1) throw failure;
        await sleep(backoff(attempt)); continue;
      }
      const answer = await readJson(response);
      if (response.ok) return answer;
      if (response.status === 401 && !refreshed) { refreshed = true; refresh(); continue; }
      const mapped = friendly(response.status, answer, who);
      if (mapped.retryable && attempt < retries - 1 && !(once && response.status >= 500)) { await sleep(backoff(attempt, response.headers?.get?.('retry-after'))); continue; }
      throw problem(mapped.message, mapped.code, { httpStatus: response.status, retryable: Boolean(mapped.retryable) });
    }
  }
  function backoff(attempt, retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 30) * 1000;
    return Math.min(1000 * 2 ** attempt, 16000) + Math.floor(Math.random() * 250);
  }
  const quote = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const drives = (driveId) => (driveId ? `&corpora=drive&driveId=${encodeURIComponent(driveId)}&includeItemsFromAllDrives=true` : '&includeItemsFromAllDrives=true');
  function multipart(metadata, media, mimeType) {
    const boundary = `studio_${crypto.randomUUID().replaceAll('-', '')}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), media, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  }
  const fileUrl = (file) => file?.webViewLink || (file?.mimeType === FOLDER_MIME ? `https://drive.google.com/drive/folders/${file.id}` : file?.mimeType === DOC_MIME ? `https://docs.google.com/document/d/${file.id}/edit` : `https://drive.google.com/file/d/${file?.id}/view`);
  return {
    request,
    fileUrl,
    // The chosen folder: its name, its shared drive (if any) and whether this sign-in may add files to it.
    async folder(folderId, { signal } = {}) {
      return request(`/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=${encodeURIComponent('id,name,mimeType,driveId,trashed,webViewLink,capabilities(canAddChildren,canEdit)')}`, { signal });
    },
    // Folders and files named `name` directly inside `parentId` (not in the trash).
    async findByName(parentId, name, { folder = true, driveId = '', signal } = {}) {
      const q = `'${quote(parentId)}' in parents and name = '${quote(name)}' and trashed = false${folder ? ` and mimeType = '${FOLDER_MIME}'` : ''}`;
      const found = await request(`/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=50&supportsAllDrives=true${drives(driveId)}&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}`, { signal });
      return Array.isArray(found.files) ? found.files : [];
    },
    // A file the studio made for an asset, found by its appProperties tag (so a lost id map never adds a second copy).
    async findTagged(parentId, key, value, { driveId = '', signal } = {}) {
      const q = `'${quote(parentId)}' in parents and trashed = false and appProperties has { key='${quote(key)}' and value='${quote(value)}' }`;
      const found = await request(`/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=10&supportsAllDrives=true${drives(driveId)}&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}`, { signal });
      return Array.isArray(found.files) ? found.files : [];
    },
    async createFolder(parentId, name, appProperties = {}, { signal } = {}) {
      return request(`/drive/v3/files?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties }), contentType: 'application/json; charset=UTF-8', signal, once: true });
    },
    // A new file from bytes: HTML becomes a Google Doc (Drive converts it), a PNG stays a PNG.
    async createFile({ parentId, name, mimeType, media, mediaType, appProperties = {} }, { signal } = {}) {
      if (media.length > MAX_UPLOAD_BYTES) throw problem('This file is larger than 5 MB, which is more than the studio uploads to Drive. Download it from the studio instead.', 'driveTooLarge');
      const upload = multipart({ name, mimeType, parents: [parentId], appProperties }, media, mediaType);
      return request(`/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, { method: 'POST', ...upload, signal, once: true });
    },
    // The same file with new contents (and name): a Google Doc is converted again from the HTML, keeping its link.
    async updateFile(fileId, { name, media, mediaType }, { signal } = {}) {
      if (media.length > MAX_UPLOAD_BYTES) throw problem('This file is larger than 5 MB, which is more than the studio uploads to Drive. Download it from the studio instead.', 'driveTooLarge');
      const upload = multipart(name ? { name } : {}, media, mediaType);
      return request(`/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, { method: 'PATCH', ...upload, signal });
    },
  };
}

// A Drive folder link (My Drive or a shared drive, any of Google's link shapes) or a bare folder id → the id, or ''.
function parseFolderLink(value) {
  const text = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(text)) return text;
  let url; try { url = new URL(text); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || !/(^|\.)drive\.google\.com$/.test(url.hostname)) return '';
  const folder = /\/folders\/([a-zA-Z0-9_-]{10,200})/.exec(url.pathname);
  if (folder) return folder[1];
  const id = url.searchParams.get('id') || '';
  return /^[a-zA-Z0-9_-]{10,200}$/.test(id) ? id : '';
}

module.exports = { parseServiceAccount, signJwt, createServiceAccountAuth, createDriveClient, parseFolderLink, friendly, TOKEN_URL, DRIVE_SCOPE, FOLDER_MIME, DOC_MIME, MAX_UPLOAD_BYTES };
