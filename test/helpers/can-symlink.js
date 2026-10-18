// Whether this machine lets the tests make a symlink. Windows refuses (EPERM) unless Developer Mode is on or the shell
// runs elevated, so suites that check "doesn't follow a link" run only where a link can exist: it.runIf(canSymlink).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function probe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-symlink-probe-'));
  try {
    fs.writeFileSync(path.join(dir, 'target'), '');
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
    return true;
  } catch (_) {
    return false;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export const canSymlink = probe();
