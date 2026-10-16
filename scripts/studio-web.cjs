// Runs the full studio for browsers: the Mac app's main process on the web runtime, served by
// studio-server.js. Configuration (see docs/web-deploy.md):
//   STUDIO_DATA_DIR        studio data folder (default ~/.scraper-studio-web); team.json (people and roles) lives in it
//   STUDIO_SECRETS_FD      the file descriptor (usually 0, standard input) to read STUDIO_SECRET_KEY and STUDIO_PASSWORD
//                          from, as NAME=value lines. Recommended: a secret in the environment stays readable by anything
//                          the server starts, including the AI on the Codex route (src/main/web-secrets.js)
//   STUDIO_SECRET_KEY      32+ random characters; encrypts keys saved in Settings
//   Sign-in, one of:
//   STUDIO_PASSWORD        admin password (16+ characters): break-glass admin access. Everyone else signs in with the
//                          personal sign-in link an admin makes in People
//   STUDIO_TRUSTED_EMAIL_HEADER + STUDIO_ALLOWED_EMAIL_DOMAINS  company sign-in through a proxy, e.g.
//                          x-auth-request-email + semrush.com. The proxy must strip any copy of the header the browser sends
//   STUDIO_ADMIN_EMAILS    with company sign-in: comma-separated emails that are always admins (also the way back in
//                          if nobody can manage People)
//   STUDIO_LINK_DAYS       how long a new sign-in link works (default 30; 0 = until it's replaced or turned off)
//   STUDIO_PUBLIC_ORIGIN   https://studio.example.com when the proxy rewrites the Host header; https also makes the
//                          session cookie Secure
//   STUDIO_SECURE_COOKIES  1 behind HTTPS (Secure cookie and HSTS);  STUDIO_HOST / PORT  bind address (default 127.0.0.1:4174)
//   STUDIO_TRUST_PROXY     1 when only the reverse proxy reaches the server: admin password tries are then counted per
//                          client address from X-Forwarded-For instead of per proxy
//   APIFY_API_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY  optional; prefer saving keys in Settings (encrypted), because a
//                          key in the environment is readable by anything the server starts
process.env.STUDIO_RUNTIME = 'web';
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../src/main/web-runtime');
const { readSecrets } = require('../src/main/web-secrets');

const webRoot = path.join(__dirname, '../out/web');
if (!fs.existsSync(path.join(webRoot, 'index.html'))) { console.error('Build the browser app first: npm run build:web'); process.exit(1); }
// The secret key and admin password are read once, from STUDIO_SECRETS_FD when it's set, and kept only in memory.
let secrets;
try { secrets = readSecrets(); } catch (error) { console.error(error.message); process.exit(1); }
const { STUDIO_SECRET_KEY: secretKey, STUDIO_PASSWORD: password } = secrets.values;
// Neither is in process.env from here on, so nothing the server starts inherits them (the AI CLI environment also drops
// every STUDIO_* variable). That can't remove them from the environment block this process started with, hence the warning.
for (const name of ['STUDIO_SECRET_KEY', 'STUDIO_PASSWORD', 'STUDIO_SECRETS_FD']) delete process.env[name];
const { dataDir } = runtime.configure({ dataDir: process.env.STUDIO_DATA_DIR || path.join(os.homedir(), '.scraper-studio-web'), secretKey, transferDir: process.env.STUDIO_TRANSFER_DIR, passwordSignIn: Boolean(password) });
require('../src/main/index.js'); // registers every handler, takes ownership of the data folder and starts the schedulers
const { createStudioServer } = require('../src/main/studio-server');
const { server } = createStudioServer({
  webRoot, runtime, password,
  secureCookies: process.env.STUDIO_SECURE_COOKIES === '1',
  trustedEmailHeader: process.env.STUDIO_TRUSTED_EMAIL_HEADER,
  allowedEmailDomains: process.env.STUDIO_ALLOWED_EMAIL_DOMAINS,
  publicOrigin: process.env.STUDIO_PUBLIC_ORIGIN,
  trustProxy: process.env.STUDIO_TRUST_PROXY === '1',
});
const bind = process.env.STUDIO_HOST || '127.0.0.1';
function signInLine() {
  const header = String(process.env.STUDIO_TRUSTED_EMAIL_HEADER || '').trim();
  const admins = String(process.env.STUDIO_ADMIN_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean).length;
  if (header) return `Sign-in: company login through the ${header.toLowerCase()} header (${process.env.STUDIO_ALLOWED_EMAIL_DOMAINS}); ${admins ? `${admins} admin ${admins === 1 ? 'email' : 'emails'} from STUDIO_ADMIN_EMAILS` : 'no STUDIO_ADMIN_EMAILS, so only admins already in People can manage people'}; sign-in links off.`;
  const raw = String(process.env.STUDIO_LINK_DAYS ?? '').trim(); const days = raw === '' ? 30 : Number(raw);
  return `Sign-in: admin password, plus personal sign-in links from People (new links work ${days === 0 ? 'until they are replaced or turned off' : `for ${Number.isFinite(days) && days > 0 ? days : 30} days`}).`;
}
server.listen(Number(process.env.PORT || 4174), bind, () => {
  console.log(`Scraper Studio (web) on http://${bind}:${server.address().port} · data ${dataDir}. Put a TLS reverse proxy in front before sharing it.`);
  console.log(signInLine());
  const them = secrets.fromEnvironment.length > 1 ? 'them' : 'it';
  if (secrets.fromEnvironment.length) console.warn(`Warning: ${secrets.fromEnvironment.join(' and ')} came from the environment, where anything this server starts can read ${them}, including the AI on the Codex route. Pass ${them} with STUDIO_SECRETS_FD instead (docs/web-deploy.md).`);
  if (secrets.unknown.length) console.warn(`Ignored ${secrets.unknown.join(', ')} in STUDIO_SECRETS_FD: only STUDIO_SECRET_KEY and STUDIO_PASSWORD are read there.`);
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  console.log('Stopping. Interrupted runs can be retried after the next start.');
  server.close(); runtime.shutdown();
  setTimeout(() => process.exit(0), 1500).unref();
});
