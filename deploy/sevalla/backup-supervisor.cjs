'use strict';
// Sevalla runs this root-owned supervisor; only the web child drops to node.
// Stored as a runtime configuration bundle so upstream image updates keep backups.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const RUNTIME = '/run/golden-thread-backups';
const PREFIX = 'golden-thread/v1/';
const MAGIC = Buffer.from('GTBACKUP1\n');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xml = (value) => String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (text, name) => xml(text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || '');
function pacific(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function due(date, lastDay) { const p = pacific(date); return p.hour >= 2 && p.day !== lastDay; }
async function fileHash(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function encrypt(source, target, key) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  fs.writeFileSync(target, Buffer.concat([MAGIC, iv]), { mode: 0o600 });
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: 'a' }));
  fs.appendFileSync(target, cipher.getAuthTag());
}
async function decrypt(source, target, key) {
  const fd = fs.openSync(source, 'r'); const size = fs.fstatSync(fd).size;
  const header = Buffer.alloc(MAGIC.length + 12); const auth = Buffer.alloc(16);
  try { fs.readSync(fd, header, 0, header.length, 0); fs.readSync(fd, auth, 0, 16, size - 16); } finally { fs.closeSync(fd); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid encrypted backup header');
  const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), header.subarray(MAGIC.length)); cipher.setAuthTag(auth);
  await pipeline(fs.createReadStream(source, { start: header.length, end: size - 17 }), cipher, fs.createWriteStream(target, { mode: 0o600 }));
}
function signed(config, method, objectKey = '', query = {}, payloadHash = sha(''), date = new Date()) {
  const url = new URL(config.endpoint);
  url.pathname = '/' + [config.bucket, ...objectKey.split('/').filter(Boolean)].map(encode).join('/');
  const queryText = Object.entries(query).map(([k, v]) => [encode(k), encode(v)]).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  url.search = queryText;
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, ''); const day = timestamp.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const names = 'host;x-amz-content-sha256;x-amz-date';
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp };
  const canonical = [method, url.pathname, queryText, `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`, names, payloadHash].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secretKey, day), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`).digest('hex');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}`;
  return { url, headers };
}
function storage(config) {
  async function request(method, key, query, file) {
    const hash = file ? await fileHash(file) : sha(''); const { url, headers } = signed(config, method, key, query, hash);
    if (file) headers['Content-Length'] = String(fs.statSync(file).size);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetch(url, { method, headers, body: file ? fs.createReadStream(file) : undefined, ...(file ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(300000) });
        if (response.ok) return response;
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) throw new Error(`Object storage returned HTTP ${response.status}`);
      } catch (error) { if (attempt === 2 || /HTTP 4/.test(error.message)) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error('Object storage request failed after retries');
  }
  return {
    async list() {
      const all = []; let cursor = '';
      do {
        const response = await request('GET', '', { 'list-type': '2', ...(cursor ? { 'continuation-token': cursor } : {}) });
        const body = await response.text();
        for (const part of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) all.push({ key: tag(part[1], 'Key'), size: Number(tag(part[1], 'Size')) });
        cursor = tag(body, 'NextContinuationToken');
        if (tag(body, 'IsTruncated') === 'true' && !cursor) throw new Error('Incomplete storage listing');
      } while (cursor);
      return all;
    },
    async put(key, file) { const r = await request('PUT', key, {}, file); await r.body?.cancel(); },
    async get(key, file) { const r = await request('GET', key, {}); await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file, { mode: 0o600 })); },
    async remove(key) { const r = await request('DELETE', key, {}); await r.body?.cancel(); },
  };
}
function owned(object) { return /^golden-thread\/v1\/(daily|deployment)\/\d{4}-\d{2}-\d{2}\/scraper-studio-backup-[\dTZ-]+\.tar\.gz\.enc$/.test(object.key); }
function expired(objects) {
  return ['daily', 'deployment'].flatMap((kind) => objects.filter((o) => owned(o) && o.key.includes(`/${kind}/`)).sort((a, b) => b.key.localeCompare(a.key)).slice(kind === 'daily' ? 14 : 3));
}
function log(event, fields = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), level: /failed/.test(event) ? 'error' : 'info', event, ...fields })); }
async function takeBackup(config, reason, options = {}) {
  const root = options.runtime || RUNTIME; fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, 'backup.lock'); let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new Error('Another backup is in progress'); throw error; }
  const tmp = fs.mkdtempSync(path.join(root, 'work-'));
  const appRoot = options.appRoot || '/app';
  const { backup, listFiles } = require(path.join(appRoot, 'scripts/studio-backup.cjs'));
  const { restore } = require(path.join(appRoot, 'scripts/studio-restore.cjs'));
  const s3 = options.storage || storage(config);
  try {
    fs.writeSync(fd, String(process.pid));
    const sourceBytes = [...listFiles(config.dataDir).files.values()].reduce((sum, f) => sum + f.size, 0);
    const space = fs.statfsSync(root);
    // Archive + encrypted upload + downloaded verification + decrypted archive +
    // isolated recovery can coexist. Refuse before filling the container's scratch disk.
    if (space.bavail * space.bsize < sourceBytes * 6 + 64 * 1024 ** 2) throw new Error('Not enough temporary disk space for a verified backup');
    const result = backup({ dataDir: config.dataDir, outDir: path.join(tmp, 'archive'), log: () => {} });
    if (!result.manifest.settled || result.manifest.files.some((f) => f.unreadableJson)) throw new Error('Backup did not settle or contains damaged JSON; refusing upload');
    const encoded = path.join(tmp, 'backup.enc'); await encrypt(result.path, encoded, config.encryptionKey);
    const bytes = fs.statSync(encoded).size;
    // Single PUT is limited to 5 GiB; stream files without loading an archive in RAM.
    if (bytes > 5 * 1024 ** 3) throw new Error('Backup exceeds single-upload limit; multipart upload is required');
    const before = await s3.list();
    if (before.some((o) => !Number.isFinite(o.size) || o.size < 0)) throw new Error('Invalid storage accounting');
    const total = before.reduce((sum, o) => sum + o.size, 0);
    if (total + bytes > config.maxBytes) throw new Error('Backup storage budget guard reached; existing backups preserved');
    const kind = reason === 'daily' ? 'daily' : 'deployment';
    const key = `${PREFIX}${kind}/${pacific().day}/${path.basename(result.path)}.enc`;
    await s3.put(key, encoded);
    const downloaded = path.join(tmp, 'download.enc'); await s3.get(key, downloaded);
    if (await fileHash(downloaded) !== await fileHash(encoded)) throw new Error('Uploaded backup checksum mismatch');
    const plain = path.join(tmp, 'restore.tar.gz'); await decrypt(downloaded, plain, config.encryptionKey);
    const target = path.join(tmp, 'recovery');
    const recovered = restore({ from: plain, dataDir: target, yes: true, log: () => {} });
    if (!recovered.restored) throw new Error('Recovery verification failed');
    // Only prune our strictly named objects after upload, download, decryption and real isolated restore pass.
    const toRemove = expired(await s3.list()); for (const object of toRemove) await s3.remove(object.key);
    const receipt = { key, reason, bytes, files: result.manifest.files.length, restored: true, completedAt: new Date().toISOString(), pruned: toRemove.length };
    fs.writeFileSync(path.join(root, 'last-success.json'), JSON.stringify(receipt), { mode: 0o600 });
    log('backup-success', receipt); return receipt;
  } finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
}
function configuration() {
  const config = {
    endpoint: process.env.GT_BACKUP_ENDPOINT, bucket: process.env.GT_BACKUP_BUCKET,
    accessKey: process.env.GT_BACKUP_ACCESS_KEY, secretKey: process.env.GT_BACKUP_SECRET_KEY,
    encryptionKey: process.env.GT_BACKUP_ENCRYPTION_KEY, dataDir: process.env.STUDIO_DATA_DIR || '/data',
    maxBytes: 95_000_000_000,
  };
  if (!config.endpoint || !config.bucket || !config.accessKey || !config.secretKey || !/^[a-f0-9]{64}$/.test(config.encryptionKey || '')) throw new Error('Backup configuration is incomplete');
  if (new URL(config.endpoint).protocol !== 'https:') throw new Error('Backup storage requires HTTPS');
  return config;
}
async function main() {
  process.umask(0o077);
  if (process.argv.includes('--once')) {
    const config = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'config.json'), 'utf8'));
    return takeBackup(config, process.argv.includes('--daily') ? 'daily' : 'manual');
  }
  if (process.getuid?.() !== 0) throw new Error('Backup supervisor must start as root');
  fs.mkdirSync(RUNTIME, { recursive: true, mode: 0o700 }); fs.chmodSync(RUNTIME, 0o700);
  const config = configuration();
  fs.writeFileSync(path.join(RUNTIME, 'config.json'), JSON.stringify(config), { mode: 0o400 });
  fs.mkdirSync(config.dataDir, { recursive: true }); fs.chownSync(config.dataDir, 1000, 1000); fs.chmodSync(config.dataDir, 0o700);
  // Fail the deployment before the app starts if its pre-start backup cannot be verified.
  await takeBackup(config, 'before-deployment');
  const objects = await storage(config).list();
  const latestDaily = objects.filter((o) => owned(o) && o.key.includes('/daily/')).sort((a, b) => b.key.localeCompare(a.key))[0];
  const local = pacific();
  let lastDay = latestDaily ? latestDaily.key.split('/')[3] : (local.hour >= 2 ? local.day : '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GT_BACKUP_')));
  const child = spawn(process.execPath, ['scripts/studio-web.cjs'], { cwd: '/app', env, stdio: 'inherit' });
  let stopping = false; let busy = false;
  let retryAfter = 0;
  const timer = setInterval(async () => {
    if (stopping || busy || Date.now() < retryAfter || !due(new Date(), lastDay)) return;
    busy = true;
    try { const receipt = await takeBackup(config, 'daily'); lastDay = receipt.key.split('/')[3]; }
    catch (error) { log('backup-failed', { message: error.message }); retryAfter = Date.now() + 15 * 60 * 1000; }
    finally { busy = false; }
  }, 30000);
  log('backup-schedule-active', { timeZone: 'America/Los_Angeles', hour: 2, dailyRetention: 14, deploymentRetention: 3, maxBytes: config.maxBytes });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; clearInterval(timer); child.kill(signal); });
  child.on('error', (error) => { log('web-start-failed', { message: error.message }); clearInterval(timer); process.exitCode = 1; });
  child.on('exit', (code, signal) => { clearInterval(timer); process.exitCode = stopping ? 0 : (code || (signal ? 1 : 0)); });
}
module.exports = { pacific, due, encrypt, decrypt, fileHash, signed, owned, expired, takeBackup, storage, main };
if (require.main === module) main().catch((error) => { log('backup-supervisor-failed', { message: error.message }); process.exitCode = 1; });
