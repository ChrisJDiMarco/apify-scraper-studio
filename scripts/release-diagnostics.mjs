import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReleaseDiagnostics } = require('../src/shared/v5-core.js');
const packageConfig = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const diagnostics = buildReleaseDiagnostics({
  platform: process.platform,
  env: process.env,
  packageConfig,
});

console.log(JSON.stringify(diagnostics, null, 2));
