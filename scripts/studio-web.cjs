// Runs the full studio for browsers: the Mac app's main process on the web runtime, served by
// studio-server.js. Configuration (see docs/web-deploy.md):
//   STUDIO_DATA_DIR        studio data folder (default ~/.scraper-studio-web)
//   STUDIO_SECRET_KEY      32+ random characters; encrypts keys saved in Settings
//   STUDIO_PASSWORD        shared sign-in password (16+ characters), unless sign-in comes from a proxy:
//   STUDIO_TRUSTED_EMAIL_HEADER + STUDIO_ALLOWED_EMAIL_DOMAINS  e.g. x-auth-request-email + semrush.com
//   STUDIO_PUBLIC_ORIGIN   https://studio.example.com when the proxy rewrites the Host header
//   STUDIO_SECURE_COOKIES  1 behind HTTPS;  STUDIO_HOST / PORT  bind address (default 127.0.0.1:4174)
//   APIFY_API_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY  optional; Settings can save keys instead
process.env.STUDIO_RUNTIME = 'web';
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../src/main/web-runtime');

const webRoot = path.join(__dirname, '../out/web');
if (!fs.existsSync(path.join(webRoot, 'index.html'))) { console.error('Build the browser app first: npm run build:web'); process.exit(1); }
const { dataDir } = runtime.configure({ dataDir: process.env.STUDIO_DATA_DIR || path.join(os.homedir(), '.scraper-studio-web'), secretKey: process.env.STUDIO_SECRET_KEY, transferDir: process.env.STUDIO_TRANSFER_DIR });
require('../src/main/index.js'); // registers every handler, takes ownership of the data folder and starts the schedulers
const { createStudioServer } = require('../src/main/studio-server');
const { server } = createStudioServer({
  webRoot, runtime,
  password: process.env.STUDIO_PASSWORD,
  secureCookies: process.env.STUDIO_SECURE_COOKIES === '1',
  trustedEmailHeader: process.env.STUDIO_TRUSTED_EMAIL_HEADER,
  allowedEmailDomains: process.env.STUDIO_ALLOWED_EMAIL_DOMAINS,
  publicOrigin: process.env.STUDIO_PUBLIC_ORIGIN,
});
const bind = process.env.STUDIO_HOST || '127.0.0.1';
server.listen(Number(process.env.PORT || 4174), bind, () => console.log(`Scraper Studio (web) on http://${bind}:${server.address().port} · data ${dataDir}. Put a TLS reverse proxy in front before sharing it.`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  console.log('Stopping. Interrupted runs can be retried after the next start.');
  server.close(); runtime.shutdown();
  setTimeout(() => process.exit(0), 1500).unref();
});
