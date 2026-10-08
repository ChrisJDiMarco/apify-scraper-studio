'use strict';
// HTTP host for the browser studio. The Mac app's main process runs on the web runtime (web-runtime.js)
// and this server exposes its handlers to signed-in browsers: POST /api/rpc calls a handler, uploads stand
// in for file dialogs, downloads for saved or opened files, and /api/events streams state like the
// desktop's state-changed push. Put it behind a TLS reverse proxy; it binds to localhost by default.
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const { methods } = require('../shared/studio-api-channels.json');

const UI_CHANNELS = new Set(Object.values(methods).map((entry) => (typeof entry === 'string' ? entry : entry.channel)));
const SESSION_MS = 12 * 3600000;
const TRANSFER_MS = 10 * 60000; // uploads and downloads live this long
const MAX_JSON_BYTES = 29000000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_EVENT_STREAMS = 50;
const STATE_COALESCE_MS = 750; // the full state is a few hundred KB; a busy run updates it many times a second
const GZIP_MIN_BYTES = 16 * 1024;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip' };
const token = () => randomBytes(32).toString('hex');
const redact = (message) => String(message || 'Request failed.').replace(/(?:sk-ant-|sk-|apify_api_)[\w-]+/g, '[redacted]');
const safeName = (value) => path.basename(String(value || 'upload')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 180) || 'upload';

function createStudioServer({ webRoot, password, secureCookies = false, runtime, transferDir, trustedEmailHeader = '', allowedEmailDomains = '', publicOrigin = '' } = {}) {
  const trustedHeader = String(trustedEmailHeader || '').trim().toLowerCase();
  // Behind a proxy that rewrites Host, the page's public origin (https://studio.example.com) is the same-origin reference.
  const publicHost = publicOrigin ? new URL(publicOrigin).host : '';
  const domains = String(allowedEmailDomains || '').split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!trustedHeader && (typeof password !== 'string' || password.length < 16)) throw new Error('Set STUDIO_PASSWORD to a unique password of at least 16 characters.');
  if (trustedHeader && !domains.length) throw new Error('Set STUDIO_ALLOWED_EMAIL_DOMAINS (for example semrush.com) when sign-in comes from a trusted proxy header.');
  if (!runtime || typeof runtime.invoke !== 'function') throw new Error('The studio server needs the web runtime.');
  const transfers = path.resolve(transferDir || runtime.settings?.transferDir || path.join(require('os').tmpdir(), 'scraper-studio-transfers'));
  fs.mkdirSync(path.join(transfers, 'uploads'), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(transfers, 'saves'), { recursive: true, mode: 0o700 });

  const sessions = new Map(); const attempts = new Map(); const uploads = new Map(); const downloads = new Map(); const streams = new Set();
  const cookieToken = (req) => req.headers.cookie?.match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  // A trusted proxy (SSO) passes the signed-in email in a header; the server must then only be reachable through it.
  function proxyUser(req) {
    if (!trustedHeader) return '';
    const email = String(req.headers[trustedHeader] || '').trim().toLowerCase();
    return /^[^@\s]+@([a-z0-9.-]+)$/.test(email) && domains.includes(email.split('@')[1]) ? email : '';
  }
  const signedIn = (req) => Boolean(proxyUser(req)) || (sessions.get(cookieToken(req)) || 0) > Date.now();
  const allowed = (channel) => typeof channel === 'string' && UI_CHANNELS.has(channel) && runtime.channels().includes(channel);

  const acceptsGzip = (req) => /\bgzip\b/.test(String(req?.headers?.['accept-encoding'] || ''));
  function send(res, status, body, headers = {}, req = null) {
    const text = Buffer.from(JSON.stringify(body));
    const zip = text.length >= GZIP_MIN_BYTES && acceptsGzip(req);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}), ...headers });
    res.end(zip ? zlib.gzipSync(text) : text);
  }
  async function readBody(req, limit) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request exceeds the upload limit.'), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const json = async (req) => { const raw = (await readBody(req, MAX_JSON_BYTES)).toString('utf8'); try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Send JSON.'); } };
  function removeLater(target) { try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) { /* already gone */ } }
  function sweep() {
    const now = Date.now();
    for (const [id, entry] of uploads) if (entry.expires < now) { uploads.delete(id); removeLater(path.dirname(entry.path)); }
    for (const [id, entry] of downloads) if (entry.expires < now) { downloads.delete(id); if (entry.temporary) removeLater(entry.temporary); }
    for (const [id, expiry] of sessions) if (expiry < now) sessions.delete(id);
  }
  const sweeper = setInterval(sweep, 60000); sweeper.unref();

  function offerDownloads(files, saveDir) {
    return files.map((file) => {
      const id = token(); const temporary = file.startsWith(saveDir + path.sep) ? saveDir : '';
      downloads.set(id, { path: file, fileName: path.basename(file), expires: Date.now() + TRANSFER_MS, temporary });
      return { url: `/api/download/${id}`, fileName: path.basename(file) };
    });
  }
  async function rpc(req, res) {
    const { channel, payload, uploads: uploadIds = [] } = await json(req);
    if (!allowed(channel)) return send(res, 400, { error: 'Unknown studio action.' });
    if (!Array.isArray(uploadIds) || uploadIds.length > 5) return send(res, 400, { error: 'Attach up to five files.' });
    const files = uploadIds.map((id) => uploads.get(String(id))).filter(Boolean);
    if (files.length !== uploadIds.length) return send(res, 410, { error: 'That upload expired. Choose the file again.' });
    const saveDir = fs.mkdtempSync(path.join(transfers, 'saves', 'call-'));
    try {
      const outcome = await runtime.invoke(channel, payload, { uploads: files, saveDir });
      const offered = offerDownloads(outcome.files || [], saveDir);
      if (!offered.some((entry) => downloads.get(entry.url.split('/').pop())?.temporary === saveDir)) removeLater(saveDir);
      return send(res, 200, { result: outcome.result === undefined ? null : outcome.result, downloads: offered, opens: (outcome.opens || []).filter((url) => /^https?:\/\//i.test(url)) }, {}, req);
    } catch (error) { removeLater(saveDir); throw error; }
    finally { for (const id of uploadIds) { const entry = uploads.get(String(id)); if (entry) { uploads.delete(String(id)); removeLater(path.dirname(entry.path)); } } }
  }
  async function upload(req, res) {
    const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] || 'upload')));
    if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD_BYTES) return send(res, 413, { error: 'Choose a file under 30 MB.' });
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const id = token(); const dir = fs.mkdtempSync(path.join(transfers, 'uploads', 'file-')); const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, body, { mode: 0o600 }); uploads.set(id, { path: filePath, expires: Date.now() + TRANSFER_MS });
    return send(res, 200, { uploadId: id });
  }
  function download(id, res, head) {
    const entry = downloads.get(id);
    if (!entry || entry.expires < Date.now() || !fs.existsSync(entry.path)) return send(res, 404, { error: 'This download expired. Run the export again.' });
    const stat = fs.statSync(entry.path); const ascii = entry.fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(entry.fileName).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (head) return res.end();
    fs.createReadStream(entry.path).pipe(res);
  }
  // Server-sent events: the state the desktop pushes to its window, coalesced so a busy run doesn't flood a tab.
  function events(req, res) {
    if (streams.size >= MAX_EVENT_STREAMS) return send(res, 503, { error: 'Too many open studio tabs. Close one and reload.' });
    const zip = acceptsGzip(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', Vary: 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}) });
    // Compressed streams flush after every event so the browser sees it at once.
    const gzip = zip ? zlib.createGzip() : null; if (gzip) gzip.pipe(res);
    const write = (text) => { if (gzip) { gzip.write(text); gzip.flush(zlib.constants.Z_SYNC_FLUSH); } else res.write(text); };
    write('retry: 3000\n\n');
    let pending = null; let timer = null;
    const flush = () => { timer = null; if (pending !== null) { write(`event: state-changed\ndata: ${JSON.stringify(pending)}\n\n`); pending = null; } };
    const stop = runtime.onBroadcast('state-changed', (state) => { pending = state; if (!timer) timer = setTimeout(flush, STATE_COALESCE_MS); });
    const heartbeat = setInterval(() => write(': keep-alive\n\n'), 25000);
    const entry = { res, end: () => (gzip ? gzip.end() : res.end()), close: () => { stop(); clearInterval(heartbeat); clearTimeout(timer); streams.delete(entry); } };
    streams.add(entry); req.on('close', entry.close);
  }
  function staticFile(url, req, res) {
    const requested = decodeURIComponent(url.pathname); const root = path.resolve(webRoot);
    const target = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, { error: 'Not found.' });
    if (!fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep)) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Cache-Control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://studio.local');
      if (req.method === 'POST') {
        // Same-origin only: no CORS and no cross-site, cookie-authenticated writes.
        const origin = req.headers.origin; let originHost = '';
        try { const parsed = new URL(origin); if (['http:', 'https:'].includes(parsed.protocol)) originHost = parsed.host; } catch (_) { originHost = ''; }
        if (!origin || !originHost || (originHost !== req.headers.host && originHost !== publicHost)) return send(res, 403, { error: 'Use the studio page to make requests.' });
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        if (!password) return send(res, 400, { error: 'This studio signs in through your company login.' });
        const ip = req.socket.remoteAddress; const entry = attempts.get(ip) || { count: 0, until: Date.now() + 60000 };
        if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 60000; }
        entry.count++; attempts.set(ip, entry);
        if (entry.count > 10) return send(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        const supplied = Buffer.from(String((await json(req)).password || '')); const expected = Buffer.from(password);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 401, { error: 'Password did not match.' });
        sweep(); if (sessions.size > 1000) return send(res, 429, { error: 'Session limit reached.' });
        const id = token(); sessions.set(id, Date.now() + SESSION_MS); attempts.delete(ip);
        return send(res, 200, { ok: true }, { 'Set-Cookie': `studio_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureCookies ? '; Secure' : ''}` });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!signedIn(req)) return send(res, 401, { error: 'Sign in to this studio.', signIn: password ? 'password' : 'proxy' });
        if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { ok: true, user: proxyUser(req) || '', signOut: !proxyUser(req) });
        if (url.pathname === '/api/logout' && req.method === 'POST') { sessions.delete(cookieToken(req)); return send(res, 200, { ok: true }, { 'Set-Cookie': `studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}` }); }
        if (url.pathname === '/api/events' && req.method === 'GET') return events(req, res);
        if (url.pathname === '/api/rpc' && req.method === 'POST') return await rpc(req, res);
        if (url.pathname === '/api/upload' && req.method === 'POST') return await upload(req, res);
        const downloadId = url.pathname.match(/^\/api\/download\/([a-f0-9]{64})$/)?.[1];
        if (downloadId && ['GET', 'HEAD'].includes(req.method)) return download(downloadId, res, req.method === 'HEAD');
        return send(res, 404, { error: 'Unknown endpoint.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Unsupported method.' });
      return staticFile(url, req, res);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 400, { error: redact(error.message) }); else res.end();
    }
  });
  server.on('close', () => { clearInterval(sweeper); for (const entry of [...streams]) { entry.close(); entry.end(); } });
  return { server };
}

module.exports = { createStudioServer, UI_CHANNELS };
