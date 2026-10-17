'use strict';
// HTTP host for the browser studio. The Mac app's main process runs on the web runtime (web-runtime.js)
// and this server exposes its handlers to signed-in browsers: POST /api/rpc calls a handler, uploads stand
// in for file dialogs, downloads for saved or opened files, and /api/events streams state like the
// desktop's state-changed push. Put it behind a TLS reverse proxy; it binds to localhost by default.
// Who is signing in comes from the main process's `people` provider (runtime.provided('people')): the admin
// password, a trusted SSO header or a personal sign-in link each resolve to an identity whose role the main
// process enforces. Without a provider (older hosts and tests) every signed-in browser has full access, as before.
// GET /healthz (the process answers) and GET /readyz (it can do its job) need no sign-in and reveal nothing private.
const http = require('http');
const net = require('net');
const os = require('os');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { randomBytes, timingSafeEqual, createHash } = require('crypto');
const { methods } = require('../shared/studio-api-channels.json');
const { copy: COPY, capabilities: CAPABILITIES = [], readMethods: READ_METHODS = [] } = require('../shared/roles.json');
const { effectiveRole } = require('./roles');
const { createServerLog, errorFields } = require('./server-log');

const CHANNEL_OF = Object.fromEntries(Object.entries(methods).map(([method, entry]) => [method, typeof entry === 'string' ? entry : entry.channel]));
const UI_CHANNELS = new Set(Object.values(CHANNEL_OF));
const READ_CHANNELS = new Set(READ_METHODS.map((method) => CHANNEL_OF[method]).filter(Boolean));
// While the server drains for a restart, methods that start paid work (every write in a capability that spends) are
// refused; stopping work, reads and ordinary saves still go through.
const DRAIN_REFUSED = new Set(CAPABILITIES.filter((capability) => capability.spends).flatMap((capability) => capability.methods || []).filter((method) => !READ_METHODS.includes(method) && !/^(?:cancel|pause)/.test(method)).map((method) => CHANNEL_OF[method]).filter(Boolean));
const SESSION_MS = 12 * 3600000; // admin password sessions
const LINK_SESSION_MS = 30 * 24 * 3600000; // personal sign-in link sessions: busy people shouldn't need the link every day
const MAX_LINK_SESSIONS = 10; // per person, so one link can't fill the session table
const MAX_SESSIONS = 1000;
const MAX_PROXY_SESSIONS = 5000; // SSO people's View as entries; the oldest goes first
const NO_ACCESS_CHANNELS = new Set(['app-meta', 'state']); // all a signed-in person without a role may call
const TRANSFER_MS = 10 * 60000; // uploads and downloads live this long
const MAX_JSON_BYTES = 29000000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_PENDING_UPLOADS = 10; // per person; one call takes up to five, and the oldest gives way
const MAX_PENDING_UPLOAD_BYTES = 1024 * 1024 * 1024; // the whole server: uploads sit on the data volume until used
const MAX_PENDING_DOWNLOADS = 20; // per person: exports kept for download; the oldest gives way
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // the whole server's temporary exports
const DEFAULT_EVENT_STREAMS = 200; // each gzip stream holds a deflate context (~256 KB) and gets every broadcast
const DEFAULT_STREAMS_PER_PERSON = 5; // one person's open tabs; their oldest stream gives way, so nobody can take every slot
const BUSY_RETRY_MS = 30000; // a tab refused for capacity asks again this often (EventSource's own reconnect)
const STREAM_BACKLOG_BYTES = 1024 * 1024; // past this, a slow tab gets only the newest state
const STREAM_STALL_MS = 60000; // a tab that takes nothing for this long is dropped (a sleeping laptop, a dead socket)
const MAX_LOGIN_BYTES = 16 * 1024; // a password or a link token: sign-in is the one request anyone can send
const STATE_COALESCE_MS = 750; // the full state is a few hundred KB; a busy run updates it many times a second
const GZIP_MIN_BYTES = 16 * 1024;
const PROXY_SECRET_HEADER = 'x-studio-proxy-secret';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip' };
const token = () => randomBytes(32).toString('hex');
const redact = (message) => String(message || 'Request failed.').replace(/(?:sk-ant-|sk-|apify_api_)[\w-]+/g, '[redacted]');
const safeName = (value) => path.basename(String(value || 'upload')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 180) || 'upload';
const noAccessMessage = (identity) => (identity.disabled ? `${COPY.paused} Ask an admin if you need it back.` : 'You’re not in this studio yet. Ask a studio admin to add you.');
const digest = (value) => createHash('sha256').update(String(value)).digest();
let version = ''; try { version = require('../../package.json').version || ''; } catch (_) { version = ''; }
// The role this request acts as: View as only ever lowers a real admin's role, and only for this session.
function effective(identity, session) {
  const seen = effectiveRole(identity?.role ?? null, identity?.channelId ?? null, session?.viewAs);
  return { ...seen, preview: identity?.role === 'admin' && seen.role !== 'admin' };
}
// Which build of the page the server serves: the hashed bundle names index.html loads. web-api.js reads the same names
// from the page it's running in, so an open tab can tell it's older than the server after a deploy.
function buildIdFrom(html) {
  const refs = [];
  for (const tag of String(html || '').match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const wanted = /^<script/i.test(tag) ? /\btype=["']module["']/i.test(tag) : /\brel=["']stylesheet["']/i.test(tag);
    const ref = tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1] || '';
    if (wanted && /\/assets\//.test(ref)) refs.push(ref.split('/').pop());
  }
  return refs.join(' ');
}
// STUDIO_TRUSTED_PROXY_CIDRS: the addresses the sign-in proxy connects from, as IPs or CIDR ranges.
function proxyAllowList(spec) {
  const entries = (Array.isArray(spec) ? spec : String(spec || '').split(',')).map((entry) => String(entry).trim()).filter(Boolean);
  if (!entries.length) return null;
  const list = new net.BlockList();
  for (const entry of entries) {
    const [address, bits, extra] = entry.split('/'); const family = net.isIP(address); const max = family === 6 ? 128 : 32;
    const prefix = bits === undefined ? max : Number(bits);
    if (!family || extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > max || (bits !== undefined && !/^\d{1,3}$/.test(bits))) throw new Error(`STUDIO_TRUSTED_PROXY_CIDRS has an entry that isn't an IP address or CIDR range: ${entry}`);
    list.addSubnet(address, prefix, family === 6 ? 'ipv6' : 'ipv4');
  }
  return { list, entries };
}
const peerOf = (req) => { const raw = String(req.socket?.remoteAddress || ''); return raw.startsWith('::ffff:') && net.isIPv4(raw.slice(7)) ? raw.slice(7) : raw; };
// Node's own errors (a missing file, a full disk, a bug) carry server paths and internals; people get a reference instead.
const systemError = (error) => Boolean(error) && !error.status && (typeof error.syscall === 'string' || typeof error.errno === 'number' || /^ERR_[A-Z0-9_]+$/.test(String(error.code || '')) || error instanceof TypeError || error instanceof ReferenceError);

function createStudioServer({ webRoot, password, secureCookies = false, runtime, transferDir, trustedEmailHeader = '', allowedEmailDomains = '', publicOrigin = '', logEvent = null, trustProxy = false, trustedProxies = '', proxySecret = '', maxEventStreams = DEFAULT_EVENT_STREAMS, maxStreamsPerPerson = DEFAULT_STREAMS_PER_PERSON, serverLog = null, lockRoot = '', minFreeMb = 256, buildId = null, streamTuning = {} } = {}) {
  const trustedHeader = String(trustedEmailHeader || '').trim().toLowerCase();
  // Behind a proxy that rewrites Host, the page's public origin (https://studio.example.com) is the same-origin reference.
  const publicHost = publicOrigin ? new URL(publicOrigin).host : '';
  // Behind HTTPS the session cookie must never travel in clear text, even when STUDIO_SECURE_COOKIES wasn't set.
  const secureCookie = secureCookies || /^https:/i.test(String(publicOrigin || ''));
  const domains = String(allowedEmailDomains || '').split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!trustedHeader && (typeof password !== 'string' || password.length < 16)) throw new Error('Set STUDIO_PASSWORD to a unique password of at least 16 characters.');
  if (trustedHeader && !domains.length) throw new Error('Set STUDIO_ALLOWED_EMAIL_DOMAINS (for example semrush.com) when sign-in comes from a trusted proxy header.');
  // The email header signs anyone in, so it is believed only from the proxy: its address, its shared secret, or both.
  const proxyList = proxyAllowList(trustedProxies);
  const proxySecretDigest = proxySecret ? digest(proxySecret) : null;
  if (proxySecret && String(proxySecret).length < 16) throw new Error('Set STUDIO_PROXY_SECRET to a random value of at least 16 characters.');
  if (trustedHeader && !proxyList && !proxySecretDigest) throw new Error('Set STUDIO_TRUSTED_PROXY_CIDRS to the sign-in proxy’s address (for example 127.0.0.1/32 on the same host, or the proxy container’s address), or STUDIO_PROXY_SECRET to a secret the proxy sends in the X-Studio-Proxy-Secret header, when sign-in comes from a trusted proxy header.');
  if (!runtime || typeof runtime.invoke !== 'function') throw new Error('The studio server needs the web runtime.');
  const streamCap = Math.max(1, Math.floor(Number(maxEventStreams) || DEFAULT_EVENT_STREAMS)); const perPerson = Math.max(1, Math.floor(Number(maxStreamsPerPerson) || DEFAULT_STREAMS_PER_PERSON));
  // Tests shorten these; the server uses the defaults.
  const { coalesceMs = STATE_COALESCE_MS, stallMs = STREAM_STALL_MS, backlogBytes = STREAM_BACKLOG_BYTES, heartbeatMs = 25000 } = streamTuning || {};
  const transfers = path.resolve(transferDir || runtime.settings?.transferDir || path.join(os.tmpdir(), 'scraper-studio-transfers'));
  // A restart forgets the upload and download tables, so nothing left in these folders can be claimed again. An exported
  // setup there can hold the plaintext Apify token, so it goes now rather than staying on the volume (and in backups).
  for (const area of ['uploads', 'saves']) { removeLater(path.join(transfers, area)); fs.mkdirSync(path.join(transfers, area), { recursive: true, mode: 0o700 }); }
  const slog = serverLog || (logEvent ? { log: (level, event, fields) => logEvent({ level, event, ...fields }) } : createServerLog());
  let build = typeof buildId === 'string' ? buildId : '';
  if (buildId === null) { try { build = buildIdFrom(fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')); } catch (_) { build = ''; } }

  // sessions: cookie token → { expires, kind: 'password'|'link', memberId?, linkId?, viewAs }. proxySessions: email → { viewAs },
  // so an SSO admin's View as lasts until the server restarts. Both live in memory: a deploy signs link users out.
  const sessions = new Map(); const proxySessions = new Map(); const attempts = new Map(); const uploads = new Map(); const downloads = new Map(); const streams = new Set();
  let draining = false; let inFlight = 0;
  const people = () => (typeof runtime.provided === 'function' && runtime.provided('people')) || null;
  const log = (event) => { const entry = { at: new Date().toISOString(), ...event }; const provider = people(); if (provider?.logEvent) provider.logEvent(entry); else if (logEvent) logEvent(entry); else console.log(JSON.stringify(entry)); };
  // Anyone can send the header, so its refusals are logged at most once a minute per address.
  const refusedPeers = new Map();
  function noteUntrusted(req) {
    const peer = peerOf(req); const now = Date.now();
    if ((refusedPeers.get(peer) || 0) > now - 60000) return;
    if (refusedPeers.size > 1000) refusedPeers.clear();
    refusedPeers.set(peer, now); slog.log('warn', 'untrusted-proxy-header', { remote: peer, reason: proxyList && !proxyList.list.check(peer, net.isIPv6(peer) ? 'ipv6' : 'ipv4') ? 'address' : 'secret' });
  }
  const cookieToken = (req) => req.headers.cookie?.match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const sessionCookie = (id, ms) => `studio_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(ms / 1000)}${secureCookie ? '; Secure' : ''}`;
  function fromProxy(req) {
    if (proxyList) { const peer = peerOf(req); if (!peer || !proxyList.list.check(peer, net.isIPv6(peer) ? 'ipv6' : 'ipv4')) return false; }
    if (proxySecretDigest) { const sent = req.headers[PROXY_SECRET_HEADER]; if (typeof sent !== 'string' || !timingSafeEqual(digest(sent), proxySecretDigest)) return false; }
    return true;
  }
  // A trusted proxy (SSO) passes the signed-in email in a header, believed only when the request came through it.
  function proxyUser(req) {
    if (!trustedHeader || req.headers[trustedHeader] === undefined) return '';
    if (!fromProxy(req)) { noteUntrusted(req); return ''; }
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
  // The id request logs carry: a member id, 'owner' for the admin password, 'guest' for someone not in People (never
  // their email).
  const logIdentity = (who) => (!who ? '' : !who.identity ? (who.email ? 'sso' : 'session') : String(who.identity.id || '').startsWith('guest:') ? 'guest' : who.identity.id);
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
  // A download's folder goes once no other offered download still points at it.
  function forgetDownload(id) {
    const entry = downloads.get(id); if (!entry) return; downloads.delete(id);
    if (entry.temporary && ![...downloads.values()].some((other) => other.temporary === entry.temporary)) removeLater(entry.temporary);
  }
  function sweep() {
    const now = Date.now();
    for (const [id, entry] of uploads) if (entry.expires < now) { uploads.delete(id); removeLater(path.dirname(entry.path)); }
    for (const [id, entry] of downloads) if (entry.expires < now) forgetDownload(id);
    for (const [id, entry] of sessions) if (entry.expires < now) endSession(id);
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  }
  const sweeper = setInterval(sweep, 60000); sweeper.unref();

  function offerDownloads(files, saveDir, owner) {
    const offered = files.map((file) => {
      const id = token(); const temporary = file.startsWith(saveDir + path.sep) ? saveDir : '';
      let size = 0; if (temporary) { try { size = fs.statSync(file).size; } catch (_) { size = 0; } }
      downloads.set(id, { path: file, fileName: path.basename(file), expires: Date.now() + TRANSFER_MS, temporary, owner, size });
      return { id, url: `/api/download/${id}`, fileName: path.basename(file) };
    });
    // Bounded like uploads: a person's oldest exports give way past their share, and the server's oldest past its total.
    const mine = [...downloads].filter(([, entry]) => entry.owner === owner).sort((a, b) => a[1].expires - b[1].expires);
    for (const [id] of mine.slice(0, Math.max(0, mine.length - MAX_PENDING_DOWNLOADS))) forgetDownload(id);
    const oldest = [...downloads].filter(([, entry]) => entry.temporary).sort((a, b) => a[1].expires - b[1].expires);
    let total = oldest.reduce((sum, [, entry]) => sum + entry.size, 0);
    for (const [id, entry] of oldest) { if (total <= MAX_DOWNLOAD_BYTES) break; total -= entry.size; forgetDownload(id); }
    return offered.filter((entry) => downloads.has(entry.id)).map(({ url, fileName }) => ({ url, fileName }));
  }
  async function rpc(req, res, who) {
    const { channel, payload, uploads: uploadIds = [] } = await json(req);
    req.studioChannel = typeof channel === 'string' ? channel.slice(0, 80) : '';
    if (!allowed(channel)) return send(res, 400, { error: 'Unknown studio action.', code: 'unknownAction' });
    if (noAccess(who) && !NO_ACCESS_CHANNELS.has(channel)) return send(res, 403, { error: noAccessMessage(who.identity) });
    if (draining && DRAIN_REFUSED.has(channel)) return send(res, 503, { error: 'The studio is restarting for an update. Try again in a minute.', code: 'restarting' }, { 'Retry-After': '60' });
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
      if (![...downloads.values()].some((entry) => entry.temporary === saveDir)) removeLater(saveDir);
      return send(res, 200, { result: outcome.result === undefined ? null : outcome.result, downloads: offered, opens: (outcome.opens || []).filter((url) => /^https?:\/\//i.test(url)) }, {}, req);
    } catch (error) { removeLater(saveDir); throw error; }
    finally { for (const id of uploadIds) { const entry = uploads.get(String(id)); if (entry) { uploads.delete(String(id)); removeLater(path.dirname(entry.path)); } } }
  }
  const pendingUploadBytes = () => [...uploads.values()].reduce((sum, entry) => sum + (entry.size || 0), 0);
  async function upload(req, res, who) {
    // Only someone who may call a method that reads a file picks one (imports, setup files, brand images); never in a
    // preview. The people provider answers from the role policy; without one, admins and editors may, as before.
    const provider = people();
    const mayUpload = !who.identity || (typeof provider?.canUpload === 'function' ? provider.canUpload(who.identity, who.session) : ['admin', 'editor'].includes(effective(who.identity, who.session).role));
    if (!mayUpload) return send(res, 403, { error: noAccess(who) ? noAccessMessage(who.identity) : COPY.forbidden });
    const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] || 'upload')));
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD_BYTES) return send(res, 413, { error: 'Choose a file under 30 MB.' });
    // A person's oldest unused upload gives way to a new one (people sharing the admin password share one owner, so a
    // refusal here would let them block each other); the server as a whole keeps a byte budget on the data volume.
    const owner = ownerOf(who); const mine = [...uploads].filter(([, entry]) => entry.owner === owner).sort((a, b) => a[1].expires - b[1].expires);
    for (const [id, entry] of mine.slice(0, Math.max(0, mine.length - MAX_PENDING_UPLOADS + 1))) { uploads.delete(id); removeLater(path.dirname(entry.path)); }
    const busy = { error: 'The studio is busy with other uploads. Try again in a few minutes.' };
    if (pendingUploadBytes() + declared > MAX_PENDING_UPLOAD_BYTES) return send(res, 429, busy, { 'Retry-After': '120' });
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (pendingUploadBytes() + body.length > MAX_PENDING_UPLOAD_BYTES) return send(res, 429, busy, { 'Retry-After': '120' }); // a chunked body sends no length
    const id = token(); const dir = fs.mkdtempSync(path.join(transfers, 'uploads', 'file-')); const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, body, { mode: 0o600 }); uploads.set(id, { path: filePath, expires: Date.now() + TRANSFER_MS, owner, size: body.length });
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
    // A preview of one person ({ memberId }) or a custom role looks like a plain admin or editor to effective(), so the
    // provider's own key (the whole viewer) separates them when it has one.
    const key = seen ? (typeof provider.viewKey === 'function' ? `${who.identity.id}|${provider.viewKey(who.identity, who.session)}` : `${who.identity.id}|${seen.role}|${seen.channelId || ''}|${seen.preview ? 'preview' : ''}|${who.session?.viewAs?.memberId || who.session?.viewAs?.role || ''}`) : '*';
    let views = rendered.get(base); if (!views) { views = new Map(); rendered.set(base, views); }
    if (!views.has(key)) views.set(key, view());
    return views.get(key);
  }
  // Whose tabs a stream counts toward: a member (all their browsers and links), an SSO email, or one admin-password
  // browser (everyone who uses the admin password shares its identity, so each browser counts on its own).
  const streamOwner = (who) => (who.identity && who.identity.via !== 'password' ? `id:${who.identity.id}` : `session:${who.token || who.email}`);
  let lastCapacityNote = 0;
  // Server-sent events: the state the desktop pushes to its window, coalesced so a busy run doesn't flood a tab.
  function events(req, res, who) {
    if (noAccess(who)) return send(res, 403, { error: noAccessMessage(who.identity) }); // the No access screen needs no pushes
    // One person's newest tab always gets live updates: past their share, their oldest stream is told it was replaced
    // (the page then stops reconnecting it) and closes, so no one person can fill the server's slots.
    const owner = streamOwner(who); const own = [...streams].filter((stream) => stream.owner === owner);
    for (const stream of own.slice(0, Math.max(0, own.length - perPerson + 1))) stream.replace();
    if (streams.size >= streamCap) {
      // A valid event stream that ends: the browser's own reconnect asks again in 30 s, and the page says live updates
      // are paused (a JSON error here would close EventSource for good, silently).
      if (Date.now() - lastCapacityNote > 60000) { lastCapacityNote = Date.now(); slog.log('warn', 'stream-refused', { reason: 'capacity', open: streams.size, max: streamCap }); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      return res.end(`retry: ${BUSY_RETRY_MS}\n\nevent: hello\ndata: ${JSON.stringify({ build, busy: true, retryMs: BUSY_RETRY_MS })}\n\n`);
    }
    const zip = acceptsGzip(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', Vary: 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}) });
    // Compressed streams flush after every event so the browser sees it at once.
    const gzip = zip ? zlib.createGzip() : null; if (gzip) gzip.pipe(res);
    let closed = false;
    const write = (text) => { if (closed) return; if (gzip) { gzip.write(text); gzip.flush(zlib.constants.Z_SYNC_FLUSH); } else res.write(text); };
    // What this stream holds in memory and hasn't sent. A tab that stops reading (a closed laptop lid, a dead socket)
    // keeps only the newest state, and is dropped once it has taken nothing for a minute.
    const backlog = () => (gzip ? gzip.writableLength : 0) + (res.writableLength || 0);
    let stalledSince = 0; let waiting = false;
    const stalled = () => {
      if (backlog() <= backlogBytes) { stalledSince = 0; return false; }
      stalledSince ||= Date.now();
      if (Date.now() - stalledSince > stallMs) entry.drop();
      return true;
    };
    write('retry: 3000\n\n');
    // Which build the server runs (an older tab offers a reload), and whether it is stopping for a restart.
    write(`event: hello\ndata: ${JSON.stringify({ build, ...(draining ? { restarting: true } : {}) })}\n\n`);
    let pending = null; let timer = null;
    // The person is looked up again at every flush: a stream whose session ended or whose access was removed closes,
    // and the browser's reconnect then meets the sign-in or no-access answer.
    const flush = () => {
      timer = null; if (closed || pending === null) return;
      if (stalled()) {
        if (!closed && !waiting) { waiting = true; (gzip || res).once('drain', () => { waiting = false; if (!closed && !timer && pending !== null) timer = setTimeout(flush, 0); }); }
        return;
      }
      const base = pending; pending = null;
      try {
        const current = identify(req);
        if (!current || noAccess(current)) return entry.stop();
        write(`event: state-changed\ndata: ${render(base, current)}\n\n`);
      } catch (error) { log({ event: 'stream-failed', error: redact(error.message) }); entry.stop(); } // a timer: never let it take the server down
    };
    const stop = runtime.onBroadcast('state-changed', (state) => { pending = state; if (!timer && !closed) timer = setTimeout(flush, coalesceMs); });
    const heartbeat = setInterval(() => { if (!stalled()) write(': keep-alive\n\n'); }, heartbeatMs);
    const entry = {
      token: who.token, // the cookie session this stream belongs to ('' for SSO)
      owner,
      close: () => { if (closed) return; closed = true; stop(); clearInterval(heartbeat); clearTimeout(timer); streams.delete(entry); },
      // A dead socket never drains, so ending it would only queue more: its buffers are freed at once instead.
      drop: () => { const open = !closed; entry.close(); if (open) slog.log('info', 'stream-dropped', { reason: 'stalled', identity: logIdentity(who) }); if (gzip) gzip.destroy(); res.destroy(); },
      stop: () => { if (backlog() > backlogBytes) return entry.drop(); const open = !closed; entry.close(); if (open) { if (gzip) gzip.end(); else res.end(); } },
      replace: () => { if (!closed) { try { write('event: replaced\ndata: {}\n\n'); } catch (_) { /* closing anyway */ } } entry.stop(); },
      restarting: () => { try { write('event: restarting\ndata: {}\n\n'); } catch (_) { /* closing anyway */ } },
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
  // Readiness: the data folder takes writes and has room, this process still owns it, and it isn't stopping. The answer
  // names which check failed, never a path, an identity or a count.
  function readiness() {
    const checks = { data: 'ok', disk: 'ok', lock: 'ok', draining };
    const dir = runtime.settings?.dataDir;
    if (dir) {
      const probe = path.join(dir, `.studio-ready-${process.pid}`);
      try { fs.writeFileSync(probe, 'ok', { mode: 0o600 }); fs.rmSync(probe, { force: true }); } catch (_) { checks.data = 'unwritable'; }
      try { const stat = fs.statfsSync(dir); if (Number(stat.bavail) * Number(stat.bsize) < Math.max(0, Number(minFreeMb) || 0) * 1024 * 1024) checks.disk = 'low'; } catch (_) { /* statfs unsupported: skip */ }
    }
    if (lockRoot) { try { if (!require('./studio-owner-lock').ownerLockHeld(lockRoot)) checks.lock = 'lost'; } catch (_) { checks.lock = 'lost'; } }
    const ready = checks.data === 'ok' && checks.disk === 'ok' && checks.lock === 'ok' && !draining;
    return { ready, version, checks };
  }
  // Starts a session for a successful sign-in. The session the browser arrived with (someone else's link, an older
  // password session) ends first, so one browser never holds two people's sessions.
  function startSession(req, res, entry, ms, resetKey = '') {
    endSession(cookieToken(req)); sweep();
    if (sessions.size >= MAX_SESSIONS) { log({ event: 'sign-in-failed', kind: entry.kind, reason: 'session-limit' }); return send(res, 429, { error: 'The studio has reached its sign-in limit. Ask an admin to restart it.' }); }
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

  // Server paths in a message written for people (a handler naming a file) become "…" before it reaches the browser.
  const roots = [...new Set([runtime.settings?.dataDir, transfers, webRoot && path.resolve(webRoot), path.resolve(__dirname, '..', '..'), os.homedir(), os.tmpdir()].filter((root) => typeof root === 'string' && root.length > 1))].sort((a, b) => b.length - a.length);
  // Only whole path tokens (after a space, quote or bracket) are replaced, so links in a message stay intact.
  const scrub = (message) => String(message).replace(/(^|[\s'"(=[])(\/[^\s'")\]]*?)([.,;:!?]*)(?=$|[\s'")\]])/g, (match, lead, token, end) => (roots.some((root) => token === root || token.startsWith(`${root}/`)) || /^\/(?:Users|home|data|srv|var|tmp|private|opt|app|root|mnt|Volumes|etc)\//.test(token) ? `${lead}…${end}` : match));
  function failed(error, req, res, requestId) {
    if (systemError(error)) {
      slog.log('error', 'request-failed', { id: requestId, route: req.studioRoute || '', channel: req.studioChannel || '', identity: logIdentity(req.studioWho), ...errorFields(error, { stack: true }) });
      const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(`${error.message} ${error.cause?.code || ''}`);
      const message = unreachable ? `The studio server couldn’t reach an outside service. Try again in a minute (ref ${requestId}).` : `Something went wrong on the studio server. Try again, or give an admin this ref: ${requestId}.`;
      if (!res.headersSent) send(res, unreachable ? 502 : 500, { error: message, ref: requestId }); else res.destroy();
      return;
    }
    // A short code that starts lower-case (the gate's copy keys: forbidden, preview, editConflict…) travels with the
    // message so screens can branch on it. System codes (ENOENT, ERR_…) start upper-case and stay on the server.
    const code = typeof error?.code === 'string' && /^[a-z][a-zA-Z0-9-]{0,39}$/.test(error.code) ? { code: error.code } : {};
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 400;
    if (status >= 500) slog.log('error', 'request-failed', { id: requestId, route: req.studioRoute || '', channel: req.studioChannel || '', identity: logIdentity(req.studioWho), ...errorFields(error) });
    if (!res.headersSent) send(res, status, { error: scrub(redact(error?.message)), ...code }); else res.destroy();
  }
  // One line per API request: id, method, route or channel, status, duration and who (an id, never an email). Reads are
  // debug, everything else info, failures error. Health checks and static files aren't logged.
  function logRequest(req, res, requestId, started) {
    const route = req.studioRoute; if (!route) return;
    const status = res.statusCode; const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const read = req.method === 'GET' || (route === '/api/rpc' && READ_CHANNELS.has(req.studioChannel));
    const level = status >= 500 ? 'error' : route === '/api/events' || (read && status < 400) ? 'debug' : 'info';
    slog.log(level, 'request', { id: requestId, method: req.method, route, ...(req.studioChannel ? { channel: req.studioChannel } : {}), status, ms, identity: logIdentity(req.studioWho), ...(res.writableFinished ? {} : { aborted: true }) });
  }

  const server = http.createServer(async (req, res) => {
    const requestId = randomBytes(6).toString('hex'); const started = process.hrtime.bigint();
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://studio.local');
      if (url.pathname === '/healthz' || url.pathname === '/readyz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Unsupported method.' });
        if (url.pathname === '/healthz') return send(res, 200, { ok: true });
        const state = readiness(); return send(res, state.ready ? 200 : 503, state);
      }
      if (url.pathname.startsWith('/api/')) {
        req.studioRoute = url.pathname.replace(/^\/api\/download\/.*/, '/api/download/:id').slice(0, 80);
        res.setHeader('X-Request-Id', requestId); if (build) res.setHeader('X-Studio-Build', build);
        res.once('close', () => logRequest(req, res, requestId, started));
      }
      if (req.method === 'POST') {
        // Same-origin only: no CORS and no cross-site, cookie-authenticated writes.
        const origin = req.headers.origin; let originHost = '';
        try { const parsed = new URL(origin); if (['http:', 'https:'].includes(parsed.protocol)) originHost = parsed.host; } catch (_) { originHost = ''; }
        if (!origin || !originHost || (originHost !== req.headers.host && originHost !== publicHost)) return send(res, 403, { error: 'Use the studio page to make requests.' });
      }
      if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res);
      if (url.pathname.startsWith('/api/')) {
        const who = identify(req); req.studioWho = who;
        if (!who) return send(res, 401, { error: 'Sign in to this studio.', signIn: password ? 'password' : 'proxy' });
        if (url.pathname === '/api/session' && req.method === 'GET') {
          const { identity } = who;
          return send(res, 200, { ok: true, user: who.email || identity?.email || '', signOut: !who.email, viewer: identity ? { name: identity.name || '', email: identity.email || '', role: identity.role ?? null, channelId: identity.channelId ?? null, disabled: Boolean(identity.disabled) } : null });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') { endSession(who.token); return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) }); }
        if (url.pathname === '/api/events' && req.method === 'GET') return events(req, res, who);
        if (url.pathname === '/api/rpc' && req.method === 'POST') { inFlight++; try { return await rpc(req, res, who); } finally { inFlight--; } }
        if (url.pathname === '/api/upload' && req.method === 'POST') { inFlight++; try { return await upload(req, res, who); } finally { inFlight--; } }
        const downloadId = url.pathname.match(/^\/api\/download\/([a-f0-9]{64})$/)?.[1];
        if (downloadId && ['GET', 'HEAD'].includes(req.method)) return download(downloadId, res, req.method === 'HEAD', who);
        return send(res, 404, { error: 'Unknown endpoint.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Unsupported method.' });
      return staticFile(url, req, res);
    } catch (error) { failed(error, req, res, requestId); }
  });
  server.on('close', () => { clearInterval(sweeper); for (const entry of [...streams]) entry.stop(); });
  return {
    server,
    // The stop sequence (scripts/studio-web.cjs): drain() refuses new paid work and tells every tab the studio is
    // restarting; inFlight() counts calls and uploads still running; closeStreams() ends the live updates so close() can finish.
    drain: () => { draining = true; for (const entry of [...streams]) entry.restarting(); },
    inFlight: () => inFlight,
    closeStreams: () => { for (const entry of [...streams]) entry.stop(); },
    readiness,
    build,
  };
}

module.exports = { createStudioServer, UI_CHANNELS, DRAIN_REFUSED, buildIdFrom, proxyAllowList };
