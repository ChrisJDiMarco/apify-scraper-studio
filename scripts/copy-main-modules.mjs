import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const copies = [
  ['src/shared/apify-runner.js', 'out/shared/apify-runner.js'],
  ['src/shared/asset-workflow.json', 'out/shared/asset-workflow.json'],
  ['src/shared/codex-runner.js', 'out/shared/codex-runner.js'],
  ['src/shared/google-sheets.js', 'out/shared/google-sheets.js'],
  ['src/shared/intelligence.js', 'out/shared/intelligence.js'],
  ['src/shared/normalize.js', 'out/shared/normalize.js'],
  ['src/shared/recipe.js', 'out/shared/recipe.js'],
  ['src/shared/report-presets.json', 'out/shared/report-presets.json'],
  ['src/shared/validation.js', 'out/shared/validation.js'],
  ['src/shared/v5-core.js', 'out/shared/v5-core.js'],
  ['src/shared/workspace.js', 'out/shared/workspace.js'],
];

for (const [from, to] of copies) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
}
