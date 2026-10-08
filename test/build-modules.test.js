import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The packaged Mac app runs out/main/index.js, which loads its sibling modules at runtime from copies made by
// scripts/copy-main-modules.mjs. A module missing from that list only fails when the installed app starts.
describe('packaged main process', () => {
  it('copies every module the main process loads', () => {
    const script = fs.readFileSync('scripts/copy-main-modules.mjs', 'utf8');
    const copied = new Set([...script.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((match) => match[1]));
    const seen = new Set(); const missing = [];
    const visit = (file) => {
      if (seen.has(file)) return; seen.add(file);
      if (!file.endsWith('.js')) return;
      for (const [, request] of fs.readFileSync(file, 'utf8').matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
        let target = path.normalize(path.join(path.dirname(file), request));
        if (!path.extname(target)) target += '.js';
        if (target.endsWith('package.json')) continue;
        if (!copied.has(target.split(path.sep).join('/'))) missing.push(`${target} (required by ${file})`);
        visit(target);
      }
    };
    visit('src/main/index.js');
    expect(missing).toEqual([]);
    expect(seen.size).toBeGreaterThan(30);
  });
});
