const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { createContentWorkspace } = require('./content-workspace');
const { createStudioHost } = require('./studio-host');
const { createImageProvider } = require('./image-provider');
const { acquireStudioOwnerLock } = require('./studio-owner-lock');
const MUTATIONS = new Set(['contentCatalog', 'selectContentWorkspace', 'saveContentWorkspace', 'saveResearchProgram', 'startResearchRun', 'approveResearchThemes', 'decideResearchTheme', 'continueResearchRun', 'createContentRun', 'cancelStudioRun', 'retryStudioRun', 'readStudioRun', 'exportStudioRun', 'readStudioAsset', 'openStudioAsset', 'importStudioSource', 'publishStudioRun']);
function createStudioServer({ root, webRoot, password, secureCookies = false, host: injectedHost, service: injectedService } = {}) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Set STUDIO_PASSWORD to a unique password of at least 16 characters.');
  const releaseOwner = acquireStudioOwnerLock(root);
  try {
  const host = injectedHost || createStudioHost({ root }); const sessions = new Map(); const attempts = new Map(); const downloads = new Map();
  const imageProvider = createImageProvider({ getApiKey: () => process.env.OPENAI_API_KEY || '' });
  const service = injectedService || createContentWorkspace({ root, ...host, generateImage: request => imageProvider.generateImage(request), publishCampaign: request => require('./google-delivery').createGoogleDelivery({ getAccessToken: () => process.env.GOOGLE_DOCS_ACCESS_TOKEN }).publishCampaign(request), capabilities: () => ({ imagesConfigured: Boolean(process.env.OPENAI_API_KEY), imageProvider: 'OpenAI', imageModel: 'gpt-image-2.5-flare', googleConfigured: Boolean(process.env.GOOGLE_DOCS_ACCESS_TOKEN), googlePublishConfigured: Boolean(process.env.GOOGLE_DOCS_ACCESS_TOKEN) }), importSource: async ({ fileName, base64, url } = {}) => {
    if (url) return require('./document-import').readGoogleDocument({ url, accessToken: process.env.GOOGLE_DOCS_ACCESS_TOKEN });
    if (typeof base64 !== 'string' || base64.length > 28000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Choose a text, Markdown, or DOCX document under 20 MB.');
    return require('./document-import').extractDocumentText({ fileName, buffer: Buffer.from(base64, 'base64') });
  } });
  service.recoverInterrupted();
  function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
  async function body(req) { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 29000000) throw new Error('Request exceeds the upload limit.'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  const authorized = req => { const cookie = req.headers.cookie?.match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/)?.[1]; return cookie && (sessions.get(cookie) || 0) > Date.now(); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://studio.local');
      if (req.method === 'POST') {
        // Same-origin only; no CORS bypass and no cross-site cookie-authenticated writes.
        const origin = req.headers.origin; if (!origin || new URL(origin).host !== req.headers.host || !['http:', 'https:'].includes(new URL(origin).protocol)) return send(res, 403, { error: 'Use the same-origin app to make requests.' });
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; const entry = attempts.get(ip) || { count: 0, until: Date.now() + 60000 }; if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 60000; } entry.count++; attempts.set(ip, entry);
        if (entry.count > 10) return send(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        const payload = await body(req); const supplied = Buffer.from(String(payload.password || '')); const expected = Buffer.from(password);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 401, { error: 'Password did not match.' });
        for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
        if (sessions.size > 1000) return send(res, 429, { error: 'Session limit reached.' });
        const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 3600000); attempts.delete(ip);
        res.setHeader('Set-Cookie', `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookies ? '; Secure' : ''}`); return send(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req)) return send(res, 401, { error: 'Sign in to this studio.' });
        if (url.pathname === '/api/logout' && req.method === 'POST') { const token = req.headers.cookie?.match(/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/)?.[1]; if (token) sessions.delete(token); res.setHeader('Set-Cookie', `studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}`); return send(res, 200, { ok: true }); }
        if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, { contentStudio: service.publicState(), settings: { aiProvider: 'claude', aiModel: process.env.CLAUDE_MODEL || 'claude-opus-5-5' } });
        if (url.pathname.startsWith('/api/download/') && req.method === 'GET') { const download = downloads.get(url.pathname); if (!download || download.workspaceId !== service.publicState().activeWorkspaceId) return send(res, 404, { error: 'Export not found.' }); res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="studio-campaign.tar.gz"', 'Cache-Control': 'no-store' }); return fs.createReadStream(download.path).pipe(res); }
        if (url.pathname !== '/api/rpc' || req.method !== 'POST') return send(res, 404, { error: 'Unknown endpoint.' });
        const { method, payload } = await body(req); if (!MUTATIONS.has(method)) return send(res, 400, { error: 'Unknown studio action.' });
        let result;
        if (method === 'openStudioAsset') result = service.readStudioAsset(payload);
        else result = await service[method](payload);
        if (method === 'exportStudioRun') { const archive = `${result.path}.tar.gz`; await promisify(execFile)('tar', ['-czf', archive, '-C', result.path, '.'], { timeout: 30000 }); const downloadUrl = `/api/download/${randomBytes(24).toString('hex')}`; downloads.set(downloadUrl, { path: archive, workspaceId: result.workspaceId }); result = { id: result.id, assetCount: result.assetCount, downloadUrl, createdAt: result.createdAt }; }
        return send(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Unsupported method.' });
      const requested = decodeURIComponent(url.pathname); const target = path.resolve(webRoot, `.${requested === '/' ? '/index.html' : requested}`); if (!target.startsWith(path.resolve(webRoot) + path.sep)) return send(res, 404, { error: 'Not found.' });
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, { error: 'Not found.' });
      if (!fs.realpathSync(target).startsWith(fs.realpathSync(webRoot) + path.sep)) return send(res, 404, { error: 'Not found.' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(target)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", 'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' }); if (req.method === 'HEAD') return res.end(); fs.createReadStream(target).pipe(res);
    } catch (error) { if (!res.headersSent) send(res, 400, { error: String(error.message || 'Request failed.').replace(/(?:sk-|apify_api_)[\w-]+/g, '[redacted]') }); else res.end(); }
  });
  server.on('listening', () => service.startResearchScheduler?.());
  server.on('close', () => {
    service.stopResearchScheduler?.();
    // Do not hand ownership to another process while a paid run is still saving.
    Promise.resolve().then(() => service.waitForIdle?.()).then(releaseOwner, releaseOwner);
  });
  server.on('error', () => { if (!server.listening) releaseOwner(); });
  return { server, service };
  } catch (error) { releaseOwner(); throw error; }
}
module.exports = { createStudioServer };
