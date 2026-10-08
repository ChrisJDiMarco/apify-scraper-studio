import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const copies = [
  ['src/main/image-provider.js', 'out/main/image-provider.js'],
  ['src/main/local-image-key.js', 'out/main/local-image-key.js'],
  ['src/main/google-delivery.js', 'out/main/google-delivery.js'],
  ['src/main/bridge-delivery.js', 'out/main/bridge-delivery.js'],
  ['src/main/ai-routes.js', 'out/main/ai-routes.js'],
  ['src/main/web-runtime.js', 'out/main/web-runtime.js'], // loaded only under STUDIO_RUNTIME=web
  ['src/main/help-images.js', 'out/main/help-images.js'],
  ['docs/app-guide.md', 'out/main/app-guide.md'], // Ask AI answers from this guide
  ['src/shared/setup-bundle.js', 'out/shared/setup-bundle.js'],
  ['src/shared/anthropic-runner.js', 'out/shared/anthropic-runner.js'],
  ['src/shared/xlsx-writer.js', 'out/shared/xlsx-writer.js'],
  ['src/main/content-workspace.js', 'out/main/content-workspace.js'],
  ['src/main/studio-owner-lock.js', 'out/main/studio-owner-lock.js'],
  ['src/main/studio-host.js', 'out/main/studio-host.js'],
  ['src/main/document-import.js', 'out/main/document-import.js'],
  ['src/main/monday-sync.js', 'out/main/monday-sync.js'],
  ['src/main/workbooks.js', 'out/main/workbooks.js'],
  ['src/main/workbook-import.js', 'out/main/workbook-import.js'],
  ['src/shared/research-workbook.js', 'out/shared/research-workbook.js'],
  ['src/shared/content-studio.js', 'out/shared/content-studio.js'],
  ['src/shared/research-program.js', 'out/shared/research-program.js'],
  ['src/shared/research-schedule.js', 'out/shared/research-schedule.js'],
  ['src/shared/research-collection.js', 'out/shared/research-collection.js'],
  ['src/shared/research-intel.js', 'out/shared/research-intel.js'],
  ['src/shared/research-prompts.js', 'out/shared/research-prompts.js'],
  ['src/shared/research-reports.js', 'out/shared/research-reports.js'],

  ['src/main/research-workspace.js', 'out/main/research-workspace.js'],
  ['src/shared/brand-context.js', 'out/shared/brand-context.js'],
  ['src/shared/research-data.js', 'out/shared/research-data.js'],
  ['src/shared/report-review.js', 'out/shared/report-review.js'],
  ['src/shared/claude-runner.js', 'out/shared/claude-runner.js'],
  ['src/shared/source-catalog.js', 'out/shared/source-catalog.js'],
  ['src/shared/source-catalog-data.json', 'out/shared/source-catalog-data.json'],
  ['src/shared/findings-chat.js', 'out/shared/findings-chat.js'],
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
