import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standard macOS format conversion only; keep the generated source and alpha intact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(tmpdir(), 'golden-thread-icon-'));
const iconset = path.join(temp, 'GoldenThread.iconset');
mkdirSync(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const target = path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), path.join(root, 'resources/golden-thread-icon.png'), '--out', target], { stdio: 'pipe' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'resources/icon.icns')], { stdio: 'inherit' });
  // electron-builder's Windows build converts resources/icon.png into the .exe and installer icon.
  copyFileSync(path.join(root, 'resources/golden-thread-icon.png'), path.join(root, 'resources/icon.png'));
  console.log('Built resources/icon.icns from the generated Golden Thread icon.');
} finally { rmSync(temp, { recursive: true, force: true }); }
