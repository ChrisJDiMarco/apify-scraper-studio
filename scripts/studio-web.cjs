const path = require('path');
const os = require('os');
const { createStudioServer } = require('../src/main/studio-server');
const root = process.env.STUDIO_DATA_DIR || path.join(os.homedir(), '.scraper-studio-web');
const bind = process.env.STUDIO_HOST || '127.0.0.1';
const { server } = createStudioServer({ root, webRoot: path.join(__dirname, '../out/web'), password: process.env.STUDIO_PASSWORD, secureCookies: process.env.STUDIO_SECURE_COOKIES === '1' });
server.listen(Number(process.env.PORT || 4174), bind, () => console.log(`Studio listening on ${bind}:${server.address().port}. Put a TLS reverse proxy in front before public deployment.`));
