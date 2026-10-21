// Runs the full studio for browsers: the Mac app's main process on the web runtime, served by
// studio-server.js. Configuration (the full table is in docs/web-deploy.md):
//   STUDIO_DATA_DIR        studio data folder (default ~/.scraper-studio-web); team.json (people and roles) lives in it.
//                          Created 0700; files the server writes are 0600 (umask 077)
//   STUDIO_TRANSFER_DIR    browser uploads and downloads (default <STUDIO_DATA_DIR>/web-transfers); emptied at start
//   Secrets (STUDIO_SECRET_KEY, STUDIO_PASSWORD, STUDIO_PROXY_SECRET) as NAME=value lines, from one of:
//   STUDIO_SECRETS_FD      an open file descriptor, usually 0 (standard input): systemd StandardInput=file:… or `< file`
//   STUDIO_SECRETS_FILE    a file path: Docker/compose secrets, Kubernetes Secret volumes. Make it root-only and start
//                          as root with STUDIO_RUN_AS, so the server's own user (and the AI it runs) can't reopen it
//   STUDIO_RUN_AS          user[:group] to switch to after reading the secrets when started as root (the image: node)
//                          A secret in the environment still works, with a warning: anything the server starts can read
//                          its starting environment, including the AI on the Codex route (src/main/web-secrets.js)
//   STUDIO_SECRET_KEY      32+ random characters; encrypts keys saved in Settings
//   Sign-in, one of:
//   STUDIO_PASSWORD        admin password (16+ characters): break-glass admin access. Everyone else signs in with the
//                          personal sign-in link an admin makes in People & access
//   STUDIO_TRUSTED_EMAIL_HEADER + STUDIO_ALLOWED_EMAIL_DOMAINS  company sign-in through a proxy, e.g.
//                          x-forwarded-email + semrush.com. The proxy must strip any copy of the header the browser sends
//   STUDIO_TRUSTED_PROXY_CIDRS  with the header: the proxy's addresses (IPs or CIDR ranges); the header is ignored from
//                          anyone else. And/or STUDIO_PROXY_SECRET (a secret): the proxy sends it as X-Studio-Proxy-Secret
//   STUDIO_ADMIN_EMAILS    with company sign-in: comma-separated emails that are always admins (also the way back in
//                          if nobody can manage People)
//   STUDIO_LINK_DAYS       how long a new sign-in link works (default 30; 0 = until it's replaced or turned off)
//   STUDIO_PUBLIC_ORIGIN   https://studio.example.com when the proxy rewrites the Host header; https also makes the
//                          session cookie Secure
//   STUDIO_SECURE_COOKIES  1 behind HTTPS (Secure cookie and HSTS);  STUDIO_HOST / PORT  bind address (default 127.0.0.1:4174)
//   STUDIO_TRUST_PROXY     1 when only the reverse proxy reaches the server: admin password tries are then counted per
//                          client address from X-Forwarded-For instead of per proxy
//   STUDIO_DRAIN_SECONDS   on SIGTERM/SIGINT, how long running work may finish before it is stopped (default 25)
//   STUDIO_MAX_EVENT_STREAMS, STUDIO_MAX_STREAMS_PER_PERSON  live-update streams (default 200, and 5 per person)
//   STUDIO_KEEPALIVE_SECONDS  idle keep-alive for proxy connections (default 75; keep it above the proxy's)
//   STUDIO_MIN_FREE_MB     /readyz fails below this much free space in the data folder (default 256)
//   STUDIO_LOG_LEVEL       error | warn | info (default) | debug; logs are JSON lines on stdout
//   ANTHROPIC_API_KEY, APIFY_API_TOKEN, OPENAI_API_KEY, GOOGLE_SHEETS_WEBHOOK_URL, GOOGLE_DOCS_ACCESS_TOKEN,
//   MONDAY_API_TOKEN       optional server-wide fallbacks; prefer saving keys in Settings (encrypted), because a key in
//                          the environment is readable by anything the server starts
process.env.STUDIO_RUNTIME = 'web';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerLog, errorFields } = require('../src/main/server-log');

const log = createServerLog();
// process.exit runs the data-folder lock's 'exit' release once index.js holds it.
function fail(message) { console.error(message); log.error('start-failed', { error: message }); process.exit(1); }
function number(name, fallback, min, max) {
  const raw = String(process.env[name] ?? '').trim(); if (!raw) return fallback;
  const value = Number(raw); if (!Number.isFinite(value) || value < min || value > max) fail(`${name} must be a number from ${min} to ${max}.`);
  return value;
}

const webRoot = path.join(__dirname, '../out/web');
if (!fs.existsSync(path.join(webRoot, 'index.html'))) fail('Build the browser app first: npm run build:web');
// The secrets are read once, from STUDIO_SECRETS_FD or STUDIO_SECRETS_FILE when set, and kept only in memory.
let secrets;
try { secrets = require('../src/main/web-secrets').readSecrets(); } catch (error) { fail(error.message); }
const { STUDIO_SECRET_KEY: secretKey, STUDIO_PASSWORD: password, STUDIO_PROXY_SECRET: proxySecret, RESEND_API_KEY: resendKey, SMTP_PASSWORD: smtpPassword } = secrets.values;
// None is in process.env from here on, so nothing the server starts inherits them (the AI CLI environment also drops
// every STUDIO_* variable). That can't remove them from the environment block this process started with, hence the warning.
for (const name of ['STUDIO_SECRET_KEY', 'STUDIO_PASSWORD', 'STUDIO_PROXY_SECRET', 'RESEND_API_KEY', 'SMTP_PASSWORD', 'STUDIO_SECRETS_FD', 'STUDIO_SECRETS_FILE']) delete process.env[name];

// Started as root (the container image): the secrets are read, then the process becomes STUDIO_RUN_AS, which can't open
// a root-only secrets file again. On Linux the switch also makes this process's memory and starting environment
// unreadable to its own user, so the AI it runs can't read them either.
const droppedRoot = (() => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;
  const target = String(process.env.STUDIO_RUN_AS || '').trim(); delete process.env.STUDIO_RUN_AS;
  if (!target) fail('The studio doesn’t run as root: the AI it runs would have root on this machine. Start it as an ordinary user, or set STUDIO_RUN_AS=<user> to read root-only secrets first and then switch to that user (the container image sets STUDIO_RUN_AS=node).');
  const [user, group = user] = target.split(':');
  try { process.initgroups(user, group); process.setgid(group); process.setuid(user); } catch (error) { fail(`Could not switch to STUDIO_RUN_AS=${target} (${error.code || error.message}).`); }
  if (process.getuid() === 0) fail(`STUDIO_RUN_AS=${target} is root. Name an ordinary user.`);
  try { const info = os.userInfo(); process.env.HOME = info.homedir; process.env.USER = info.username; process.env.LOGNAME = info.username; } catch (_) { /* keep HOME */ }
  return process.platform === 'linux';
})();
delete process.env.STUDIO_RUN_AS;
process.umask(0o077); // new folders 0700 and files 0600: the data folder holds posts, chats and encrypted keys

const warnings = [];
if (secrets.fromEnvironment.length && !droppedRoot) {
  const them = secrets.fromEnvironment.length > 1 ? 'them' : 'it';
  warnings.push(`Warning: ${secrets.fromEnvironment.join(' and ')} came from the environment, where anything this server starts can read ${them}, including the AI on the Codex route. Pass ${them} with STUDIO_SECRETS_FD or STUDIO_SECRETS_FILE instead (docs/web-deploy.md).`);
}
if (secrets.file) { let readable = false; try { fs.accessSync(secrets.file, fs.constants.R_OK); readable = true; } catch (_) { readable = false; } if (readable) warnings.push(`Warning: STUDIO_SECRETS_FILE (${secrets.file}) is readable by the server’s own user, so the AI on the Codex route could read it. Make it root-only (0400) and start as root with STUDIO_RUN_AS (the container image does), or use STUDIO_SECRETS_FD.`); }
if (secrets.unknown.length) warnings.push(`Ignored ${secrets.unknown.join(', ')} in the secrets: only STUDIO_SECRET_KEY, STUDIO_PASSWORD, STUDIO_PROXY_SECRET, RESEND_API_KEY and SMTP_PASSWORD are read there.`);

const drainSeconds = number('STUDIO_DRAIN_SECONDS', 25, 0, 3600);
const keepAliveSeconds = number('STUDIO_KEEPALIVE_SECONDS', 75, 1, 3600);
const port = number('PORT', 4174, 0, 65535);
const bind = process.env.STUDIO_HOST || '127.0.0.1';
const runtime = require('../src/main/web-runtime');
let dataDir;
try { ({ dataDir } = runtime.configure({ dataDir: process.env.STUDIO_DATA_DIR || path.join(os.homedir(), '.scraper-studio-web'), secretKey, transferDir: process.env.STUDIO_TRANSFER_DIR, passwordSignIn: Boolean(password), emailSecrets: { RESEND_API_KEY: resendKey, SMTP_PASSWORD: smtpPassword } })); }
catch (error) { fail(error.message); }
// The data-folder lock is released when the process exits, after aborted work has saved its last state, not at 'quit'.
require('../src/main/studio-owner-lock').releaseOnlyAtExit();
require('../src/main/index.js'); // registers every handler, takes ownership of the data folder and starts the schedulers
const { createStudioServer } = require('../src/main/studio-server');
let studio;
try {
  studio = createStudioServer({
    webRoot, runtime, password,
    secureCookies: process.env.STUDIO_SECURE_COOKIES === '1',
    trustedEmailHeader: process.env.STUDIO_TRUSTED_EMAIL_HEADER,
    allowedEmailDomains: process.env.STUDIO_ALLOWED_EMAIL_DOMAINS,
    trustedProxies: process.env.STUDIO_TRUSTED_PROXY_CIDRS, proxySecret,
    publicOrigin: process.env.STUDIO_PUBLIC_ORIGIN,
    trustProxy: process.env.STUDIO_TRUST_PROXY === '1',
    maxEventStreams: number('STUDIO_MAX_EVENT_STREAMS', 200, 1, 100000),
    maxStreamsPerPerson: number('STUDIO_MAX_STREAMS_PER_PERSON', 5, 1, 100),
    minFreeMb: number('STUDIO_MIN_FREE_MB', 256, 0, 10000000),
    lockRoot: path.join(dataDir, 'content-studio'), // where index.js takes the data-folder lock (dataPath('content-studio'))
    serverLog: log,
  });
} catch (error) { fail(error.message); }
const { server } = studio;
// Behind a proxy that keeps idle connections open, Node must not close them first, or a reused one fails as a 502.
server.keepAliveTimeout = keepAliveSeconds * 1000; server.headersTimeout = keepAliveSeconds * 1000 + 5000;

function signInLine() {
  const header = String(process.env.STUDIO_TRUSTED_EMAIL_HEADER || '').trim();
  const admins = String(process.env.STUDIO_ADMIN_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean).length;
  if (header) {
    const trust = [String(process.env.STUDIO_TRUSTED_PROXY_CIDRS || '').trim() && `from ${String(process.env.STUDIO_TRUSTED_PROXY_CIDRS).split(',').map((entry) => entry.trim()).filter(Boolean).join(', ')}`, proxySecret && 'with the proxy secret'].filter(Boolean).join(' and ');
    return `Sign-in: company login through the ${header.toLowerCase()} header (${process.env.STUDIO_ALLOWED_EMAIL_DOMAINS}), trusted only ${trust}; ${admins ? `${admins} admin ${admins === 1 ? 'email' : 'emails'} from STUDIO_ADMIN_EMAILS` : 'no STUDIO_ADMIN_EMAILS, so only admins already in People can manage people'}; sign-in links off.`;
  }
  const raw = String(process.env.STUDIO_LINK_DAYS ?? '').trim(); const days = raw === '' ? 30 : Number(raw);
  return `Sign-in: admin password, plus personal sign-in links from People (new links work ${days === 0 ? 'until they are replaced or turned off' : `for ${Number.isFinite(days) && days > 0 ? days : 30} days`}).`;
}
server.on('error', (error) => fail(error.code === 'EADDRINUSE' ? `Port ${port} on ${bind} is already in use. Stop the other server or set PORT.` : `The server could not start: ${error.message}`));
server.listen(port, bind, () => {
  console.log(`Golden Thread (web) on http://${bind}:${server.address().port} · data ${dataDir}. Put a TLS reverse proxy in front before sharing it.`);
  console.log(signInLine());
  for (const line of warnings) console.warn(line);
  log.info('started', { version: runtime.electron.app.getVersion(), port: server.address().port, signIn: process.env.STUDIO_TRUSTED_EMAIL_HEADER ? 'proxy' : 'password', build: studio.build, drainSeconds, droppedRoot });
});

// Stopping (docker stop, systemd, Kubernetes, Ctrl-C): stop taking new paid work, let running work finish for up to
// STUDIO_DRAIN_SECONDS, then stop what's left and exit. A second signal skips the wait.
let signals = 0; let finishing = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const running = () => studio.inFlight() + runtime.busyWork().length;
async function stop(signal) {
  signals += 1;
  if (signals > 1) { log.warn('stop-now', { signal }); return finish(0); }
  runtime.settings.draining = true; studio.drain();
  const busy = running();
  log.info('draining', { signal, seconds: drainSeconds, running: busy });
  if (busy && drainSeconds) console.log(`Stopping: letting running work finish for up to ${drainSeconds} s. Send ${signal} again to stop now.`);
  const deadline = Date.now() + drainSeconds * 1000;
  while (!finishing && Date.now() < deadline && running()) await sleep(1000);
  finish(0);
}
function finish(code) {
  if (finishing) return; finishing = true;
  const left = running();
  log.info('stopping', { interrupted: left });
  if (left) console.log('Stopping. Interrupted runs can be retried after the next start.');
  try { server.close(); studio.closeStreams(); server.closeIdleConnections?.(); } catch (_) { /* already closed */ }
  try { runtime.shutdown(); } catch (error) { log.error('shutdown-failed', errorFields(error)); } // 'quit': stops schedules and AI work
  // Aborted work records itself as interrupted; exit once it has (or after a few seconds). The lock goes last, at exit.
  const until = Date.now() + 3000;
  const check = () => { if (Date.now() >= until || !running()) process.exit(code); else setTimeout(check, 100); };
  setTimeout(check, 100);
  setTimeout(() => process.exit(code), 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(signal).catch((error) => { log.error('stop-failed', errorFields(error, { stack: true })); finish(1); }); });
// A promise nobody handled (run bookkeeping, a background save) is logged and the server keeps serving, as Electron's
// main process does. An exception nobody caught leaves the process in an unknown state: log it, stop cleanly, exit 1,
// and let the service manager start a fresh one.
process.on('unhandledRejection', (reason) => log.error('unhandled-rejection', errorFields(reason, { stack: true })));
process.on('uncaughtException', (error) => {
  log.error('uncaught-exception', errorFields(error, { stack: true }));
  if (!finishing) { runtime.settings.draining = true; try { studio?.drain(); } catch (_) { /* stopping anyway */ } finish(1); }
});
