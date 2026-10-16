'use strict';
// HTTP host for the browser studio. The Mac app's main process runs on the web runtime (web-runtime.js)
// and this server exposes its handlers to signed-in browsers: POST /api/rpc calls a handler, uploads stand
// in for file dialogs, downloads for saved or opened files, and /api/events streams state like the
// desktop's state-changed push. Put it behind a TLS reverse proxy; it binds to localhost by default.
// Who is signing in comes from the main process's `people` provider (runtime.provided('people')): the admin
// password, a trusted SSO header or a personal sign-in link each resolve to an identity whose role the main
// process enforces. Without a provider (older hosts and tests) every signed-in browser has full access, as before.
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const { methods } = require('../shared/studio-api-channels.json');
const { copy: COPY } = require('../shared/roles.json');
const { effectiveRole } = require('./roles');

const UI_CHANNELS = new Set(Object.values(methods).map((entry) => (typeof entry === 'string' ? entry : entry.channel)));
const SESSION_MS = 12 * 3600000; // admin password sessions
const LINK_SESSION_MS = 30 * 24 * 3600000; // personal sign-in link sessions: busy people shouldn't need the link every day
const MAX_LINK_SESSIONS = 10; // per person, so one link can't fill the session table
const MAX_PROXY_SESSIONS = 5000; // SSO people's View as entries; the oldest goes first
const NO_ACCESS_CHANNELS = new Set(['app-meta', 'state']); // all a signed-in person without a role may call
const TRANSFER_MS = 10 * 60000; // uploads and downloads live this long
const MAX_JSON_BYTES = 29000000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_EVENT_STREAMS = 50;
const MAX_STREAMS_PER_PERSON = 5; // one person's open tabs; their oldest stream gives way, so nobody can take every slot
const MAX_LOGIN_BYTES = 16 * 1024; // a password or a link token: sign-in is the one request anyone can send
const STATE_COALESCE_MS = 750; // the full state is a few hundred KB; a busy run updates it many times a second
const GZIP_MIN_BYTES = 16 * 1024;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip' };
const token = () => randomBytes(32).toString('hex');
const redact = (message) => String(message || 'Request failed.').replace(/(?:sk-ant-|sk-|apify_api_)[\w-]+/g, '[redacted]');
const safeName = (value) => path.basename(String(value || 'upload')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 180) || 'upload';
const noAccessMessage = (identity) => (identity.disabled ? `${COPY.paused} Ask an admin if you need it back.` : 'You’re not in this studio yet. Ask a studio admin to add you.');
// The role this request acts as: View as only ever lowers a real admin's role, and only for this session.
function effective(identity, session) {
  const seen = effectiveRole(identity?.role ?? null, identity?.channelId ?? null, session?.viewAs);
  return { ...seen, preview: identity?.role === 'admin' && seen.role !== 'admin' };
}

function createStudioServer({ webRoot, password, secureCookies = false, runtime, transferDir, trustedEmailHeader = '', allowedEmailDomains = '', publicOrigin = '', logEvent = null, trustProxy = false } = {}) {
  const trustedHeader = String(trustedEmailHeader || '').trim().toLowerCase();
  // Behind a proxy that rewrites Host, the page's public origin (https://studio.example.com) is the same-origin reference.
  const publicHost = publicOrigin ? new URL(publicOrigin).host : '';
  // Behind HTTPS the session cookie must never travel in clear text, even when STUDIO_SECURE_COOKIES wasn't set.
  const secureCookie = secureCookies || /^https:/i.test(String(publicOrigin || ''));
  const domains = String(allowedEmailDomains || '').split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!trustedHeader && (typeof password !== 'string' || password.length < 16)) throw new Error('Set STUDIO_PASSWORD to a unique password of at least 16 characters.');
  if (trustedHeader && !domains.length) throw new Error('Set STUDIO_ALLOWED_EMAIL_DOMAINS (for example semrush.com) when sign-in comes from a trusted proxy header.');
  if (!runtime || typeof runtime.invoke !== 'function') throw new Error('The studio server needs the web runtime.');
  const transfers = path.resolve(transferDir || runtime.settings?.transferDir || path.join(require('os').tmpdir(), 'scraper-studio-transfers'));
  fs.mkdirSync(path.join(transfers, 'uploads'), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(transfers, 'saves'), { recursive: true, mode: 0o700 });

  // sessions: cookie token → { expires, kind: 'password'|'link', memberId?, linkId?, viewAs }. proxySessions: email → { viewAs },
  // so an SSO admin's View as lasts until the server restarts. Both live in memory: a deploy signs link users out.
  const sessions = new Map(); const proxySessions = new Map(); const attempts = new Map(); const uploads = new Map(); const downloads = new Map(); const streams = new Set();
  const people = () => (typeof runtime.provided === 'function' && runtime.provided('people')) || null;
  const log = (event) => { const entry = { at: new Date().toISOString(), ...event }; const provider = people(); if (provider?.logEvent) provider.logEvent(entry); else if (logEvent) logEvent(entry); else console.log(JSON.stringify(entry)); };
  const cookieToken = (req) => req.headers.cookie?.match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const sessionCookie = (id, ms) => `studio_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(ms / 1000)}${secureCookie ? '; Secure' : ''}`;
  // A trusted proxy (SSO) passes the signed-in email in a header; the server must then only be reachable through it.
  function proxyUser(req) {
    if (!trustedHeader) return '';
    const email = String(req.headers[trustedHeader] || '').trim().toLowerCase();
    return /^[^@\s]+@([a-z0-9.-]+)$/.test(email) && domains.includes(email.split('@')[1]) ? email : '';
  }
  // Ending a session also closes the live-update streams it opened, so a signed-out tab stops receiving state.
  function endSession(id) {
    if (!id) return;
    sessions.delete(id);
    for (const stream of [...streams]) if (stream.token === id) stream.stop();
  }
  // Who is making this request: { identity, session, token, email }, or null when signed out. The member is looked up on
  // every request, so a role change, a disabled member or a replaced sign-in link applies at once. Without a people
  // provider, identity stays null and the request has full access, as before roles.
  function identify(req) {
    const provider = people(); const email = proxyUser(req);
    if (email) {
      let session = proxySessions.get(email);
      if (!session) { if (proxySessions.size >= MAX_PROXY_SESSIONS) proxySessions.delete(proxySessions.keys().next().value); session = { viewAs: null }; proxySessions.set(email, session); }
      // fromProxyEmail always answers; a missing answer still fails closed as someone with no access.
      const identity = provider ? provider.fromProxyEmail(email) || { id: `guest:${email}`, name: email.split('@')[0], email, role: null, channelId: null, via: 'proxy' } : null;
      return { identity, session, token: '', email };
    }
    const id = cookieToken(req); const entry = id ? sessions.get(id) : null;
    if (!entry || !(entry.expires > Date.now())) return null;
    if (!provider) return { identity: null, session: entry, token: id, email: '' };
    const identity = entry.kind === 'link' ? provider.fromLinkSession(entry) : provider.ownerIdentity();
    if (!identity) { endSession(id); return null; } // the member was removed, or their link was replaced or turned off
    return { identity, session: entry, token: id, email: '' };
  }
  const noAccess = (who) => Boolean(who.identity) && !who.identity.role;
  const ownerOf = (who) => who.identity?.id || ''; // uploads and downloads belong to the identity that made them
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
  const json = async (req, limit = MAX_JSON_BYTES) => { const raw = (await readBody(req, limit)).toString('utf8'); try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Send JSON.'); } };
  // The address password guesses are counted against. Behind the documented reverse proxy every request comes from the
  // proxy, so with trustProxy (STUDIO_TRUST_PROXY=1) the client address the proxy appended to X-Forwarded-For is used.
  function clientKey(req) {
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean).pop() : '';
    return forwarded || req.socket.remoteAddress || '';
  }
  function removeLater(target) { try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) { /* already gone */ } }
  function sweep() {
    const now = Date.now();
    for (const [id, entry] of uploads) if (entry.expires < now) { uploads.delete(id); removeLater(path.dirname(entry.path)); }
    for (const [id, entry] of downloads) if (entry.expires < now) { downloads.delete(id); if (entry.temporary) removeLater(entry.temporary); }
    for (const [id, entry] of sessions) if (entry.expires < now) endSession(id);
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  }
  const sweeper = setInterval(sweep, 60000); sweeper.unref();

  function offerDownloads(files, saveDir, owner) {
    return files.map((file) => {
      const id = token(); const temporary = file.startsWith(saveDir + path.sep) ? saveDir : '';
      downloads.set(id, { path: file, fileName: path.basename(file), expires: Date.now() + TRANSFER_MS, temporary, owner });
      return { url: `/api/download/${id}`, fileName: path.basename(file) };
    });
  }
  async function rpc(req, res, who) {
    const { channel, payload, uploads: uploadIds = [] } = await json(req);
    if (!allowed(channel)) return send(res, 400, { error: 'Unknown studio action.' });
    if (noAccess(who) && !NO_ACCESS_CHANNELS.has(channel)) return send(res, 403, { error: noAccessMessage(who.identity) });
    if (!Array.isArray(uploadIds) || uploadIds.length > 5) return send(res, 400, { error: 'Attach up to five files.' });
    const entries = uploadIds.map((id) => uploads.get(String(id)));
    if (entries.some((entry) => entry && entry.owner !== ownerOf(who))) return send(res, 404, { error: 'That upload expired. Choose the file again.' });
    const files = entries.filter(Boolean);
    if (files.length !== uploadIds.length) return send(res, 410, { error: 'That upload expired. Choose the file again.' });
    const saveDir = fs.mkdtempSync(path.join(transfers, 'saves', 'call-'));
    try {
      // The origin check already passed, so the Origin header is the studio page's own address (sign-in links use it).
      const outcome = await runtime.invoke(channel, payload, { uploads: files, saveDir, user: who.identity, session: who.session, origin: new URL(req.headers.origin).origin });
      const offered = offerDownloads(outcome.files || [], saveDir, ownerOf(who));
      if (!offered.some((entry) => downloads.get(entry.url.split('/').pop())?.temporary === saveDir)) removeLater(saveDir);
      return send(res, 200, { result: outcome.result === undefined ? null : outcome.result, downloads: offered, opens: (outcome.opens || []).filter((url) => /^https?:\/\//i.test(url)) }, {}, req);
    } catch (error) { removeLater(saveDir); throw error; }
    finally { for (const id of uploadIds) { const entry = uploads.get(String(id)); if (entry) { uploads.delete(String(id)); removeLater(path.dirname(entry.path)); } } }
  }
  async function upload(req, res, who) {
    // Only admins and editors pick files (imports, setup files); a preview as a channel owner can't either.
    if (who.identity && !['admin', 'editor'].includes(effective(who.identity, who.session).role)) return send(res, 403, { error: noAccess(who) ? noAccessMessage(who.identity) : COPY.forbidden });
    const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] || 'upload')));
    if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD_BYTES) return send(res, 413, { error: 'Choose a file under 30 MB.' });
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const id = token(); const dir = fs.mkdtempSync(path.join(transfers, 'uploads', 'file-')); const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, body, { mode: 0o600 }); uploads.set(id, { path: filePath, expires: Date.now() + TRANSFER_MS, owner: ownerOf(who) });
    return send(res, 200, { uploadId: id });
  }
  function download(id, res, head, who) {
    const entry = downloads.get(id);
    if (!entry || entry.owner !== ownerOf(who) || entry.expires < Date.now() || !fs.existsSync(entry.path)) return send(res, 404, { error: 'This download expired. Run the export again.' });
    const stat = fs.statSync(entry.path); const ascii = entry.fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(entry.fileName).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (head) return res.end();
    fs.createReadStream(entry.path).pipe(res);
  }
  // Each person sees their own projection of the state. Every stream that flushes the same broadcast shares one
  // rendering per view (identity, effective role and channel, preview), so a broadcast is projected and serialised
  // once per distinct viewer, not once per tab.
  const rendered = new WeakMap();
  function render(base, who) {
    const provider = people();
    const view = () => (provider ? provider.view(base, who.identity, who.session) : JSON.stringify(base));
    if (!base || typeof base !== 'object') return view();
    const seen = provider && effective(who.identity, who.session);
    const key = seen ? `${who.identity.id}|${seen.role}|${seen.channelId || ''}|${seen.preview ? 'preview' : ''}` : '*';
    let views = rendered.get(base); if (!views) { views = new Map(); rendered.set(base, views); }
    if (!views.has(key)) views.set(key, view());
    return views.get(key);
  }
  // Whose tabs a stream counts toward: a member (all their browsers and links), an SSO email, or one admin-password
  // browser (everyone who uses the admin password shares its identity, so each browser counts on its own).
  const streamOwner = (who) => (who.identity && who.identity.via !== 'password' ? `id:${who.identity.id}` : `session:${who.token || who.email}`);
  // Server-sent events: the state the desktop pushes to its window, coalesced so a busy run doesn't flood a tab.
  function events(req, res, who) {
    if (noAccess(who)) return send(res, 403, { error: noAccessMessage(who.identity) }); // the No access screen needs no pushes
    // One person's newest tab always gets live updates: past their share, their oldest stream is told it was replaced
    // (the page then stops reconnecting it) and closes, so no one person can fill the server's slots.
    const owner = streamOwner(who); const own = [...streams].filter((stream) => stream.owner === owner);
    for (const stream of own.slice(0, Math.max(0, own.length - MAX_STREAMS_PER_PERSON + 1))) stream.replace();
    if (streams.size >= MAX_EVENT_STREAMS) return send(res, 503, { error: 'Too many open studio tabs. Close one and reload.' });
    const zip = acceptsGzip(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', Vary: 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}) });
    // Compressed streams flush after every event so the browser sees it at once.
    const gzip = zip ? zlib.createGzip() : null; if (gzip) gzip.pipe(res);
    const write = (text) => { if (gzip) { gzip.write(text); gzip.flush(zlib.constants.Z_SYNC_FLUSH); } else res.write(text); };
    write('retry: 3000\n\n');
    let pending = null; let timer = null;
    // The person is looked up again at every flush: a stream whose session ended or whose access was removed closes,
    // and the browser's reconnect then meets the sign-in or no-access answer.
    const flush = () => {
      timer = null; if (pending === null) return;
      const base = pending; pending = null;
      try {
        const current = identify(req);
        if (!current || noAccess(current)) return entry.stop();
        write(`event: state-changed\ndata: ${render(base, current)}\n\n`);
      } catch (error) { log({ event: 'stream-failed', error: redact(error.message) }); entry.stop(); } // a timer: never let it take the server down
    };
    const stop = runtime.onBroadcast('state-changed', (state) => { pending = state; if (!timer) timer = setTimeout(flush, STATE_COALESCE_MS); });
    const heartbeat = setInterval(() => write(': keep-alive\n\n'), 25000);
    let closed = false;
    const entry = {
      token: who.token, // the cookie session this stream belongs to ('' for SSO)
      owner,
      close: () => { if (closed) return; closed = true; stop(); clearInterval(heartbeat); clearTimeout(timer); streams.delete(entry); },
      stop: () => { const open = !closed; entry.close(); if (open) { if (gzip) gzip.end(); else res.end(); } },
      replace: () => { if (!closed) { try { write('event: replaced\ndata: {}\n\n'); } catch (_) { /* closing anyway */ } } entry.stop(); },
    };
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
  // Starts a session for a successful sign-in. The session the browser arrived with (someone else's link, an older
  // password session) ends first, so one browser never holds two people's sessions.
  function startSession(req, res, entry, ms, resetKey = '') {
    sweep(); if (sessions.size > 1000) { log({ event: 'sign-in-failed', kind: entry.kind, reason: 'session-limit' }); return send(res, 429, { error: 'Session limit reached.' }); }
    endSession(cookieToken(req));
    if (entry.kind === 'link') {
      const own = [...sessions].filter(([, session]) => session.kind === 'link' && session.memberId === entry.memberId).sort((a, b) => a[1].expires - b[1].expires);
      for (const [id] of own.slice(0, Math.max(0, own.length - MAX_LINK_SESSIONS + 1))) endSession(id);
    }
    const id = token(); sessions.set(id, { ...entry, expires: Date.now() + ms, viewAs: null }); if (resetKey) attempts.delete(resetKey);
    log({ event: 'sign-in', kind: entry.kind, ...(entry.memberId ? { memberId: entry.memberId } : {}) });
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(id, ms) });
  }
  async function login(req, res) {
    if (!password) return send(res, 400, { error: 'This studio signs in through your company login.' });
    const body = await json(req, MAX_LOGIN_BYTES);
    // A personal sign-in link: the token came from the page's #signin= fragment, so it never reached a server log. Tokens
    // are 32 random bytes, so guessing one is hopeless and needs no limit; counting link tries against the password
    // limiter would let anyone lock every channel owner and editor out, since behind a proxy they share one address.
    if (body.linkToken !== undefined) {
      const provider = people(); const linkToken = String(body.linkToken || '');
      const found = provider && /^[a-f0-9]{64}$/.test(linkToken) ? provider.linkLogin(linkToken) : null;
      if (!found) { log({ event: 'sign-in-failed', kind: 'link' }); return send(res, 401, { error: COPY.linkInvalid, signIn: 'link-invalid' }); }
      return startSession(req, res, { kind: 'link', memberId: found.memberId, linkId: found.linkId }, LINK_SESSION_MS);
    }
    // The admin password: ten tries a minute per client address.
    const key = clientKey(req); const entry = attempts.get(key) || { count: 0, until: Date.now() + 60000 };
    if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 60000; }
    entry.count++; attempts.set(key, entry);
    if (entry.count > 10) { log({ event: 'sign-in-failed', kind: 'password', reason: 'rate-limited' }); return send(res, 429, { error: 'Too many attempts. Try again in a minute.' }); }
    const supplied = Buffer.from(String(body.password || '')); const expected = Buffer.from(password);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { log({ event: 'sign-in-failed', kind: 'password' }); return send(res, 401, { error: 'Password did not match.' }); }
    return startSession(req, res, { kind: 'password' }, SESSION_MS, key);
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
      if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res);
      if (url.pathname.startsWith('/api/')) {
        const who = identify(req);
        if (!who) return send(res, 401, { error: 'Sign in to this studio.', signIn: password ? 'password' : 'proxy' });
        if (url.pathname === '/api/session' && req.method === 'GET') {
          const { identity } = who;
          return send(res, 200, { ok: true, user: who.email || identity?.email || '', signOut: !who.email, viewer: identity ? { name: identity.name || '', email: identity.email || '', role: identity.role ?? null, channelId: identity.channelId ?? null, disabled: Boolean(identity.disabled) } : null });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') { endSession(who.token); return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) }); }
        if (url.pathname === '/api/events' && req.method === 'GET') return events(req, res, who);
        if (url.pathname === '/api/rpc' && req.method === 'POST') return await rpc(req, res, who);
        if (url.pathname === '/api/upload' && req.method === 'POST') return await upload(req, res, who);
        const downloadId = url.pathname.match(/^\/api\/download\/([a-f0-9]{64})$/)?.[1];
        if (downloadId && ['GET', 'HEAD'].includes(req.method)) return download(downloadId, res, req.method === 'HEAD', who);
        return send(res, 404, { error: 'Unknown endpoint.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Unsupported method.' });
      return staticFile(url, req, res);
    } catch (error) {
      // A short code that starts lower-case (the gate's copy keys: forbidden, preview, editConflict…) travels with the
      // message so screens can branch on it. System codes (ENOENT, ERR_…) start upper-case and stay on the server.
      const code = typeof error.code === 'string' && /^[a-z][a-zA-Z0-9-]{0,39}$/.test(error.code) ? { code: error.code } : {};
      if (!res.headersSent) send(res, error.status || 400, { error: redact(error.message), ...code }); else res.end();
    }
  });
  server.on('close', () => { clearInterval(sweeper); for (const entry of [...streams]) entry.stop(); });
  return { server };
}

module.exports = { createStudioServer, UI_CHANNELS };
