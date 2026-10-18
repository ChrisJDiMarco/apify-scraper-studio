'use strict';
// Saving files so that Windows doesn't turn an ordinary save into an error. Antivirus and EDR scanners, the Search
// indexer and backup or sync agents open a file the moment it is closed, and while one holds it a rename over it fails
// with EPERM, EACCES or EBUSY. Every atomic save in the studio (temp file, fsync, rename) renames through renameDurable,
// which on Windows waits and tries again for about two seconds, as graceful-fs does. On the Mac and Linux it is a plain
// fs.renameSync. The platform and fs are options so tests (and index.js, under a test's fake process) can pass their own.
// CommonJS, Electron-free: the Mac app, the Windows app and the browser studio's server all load it.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
// A folder fsync makes the rename itself survive a power cut. Windows and some file systems can't open or sync a folder.
const FOLDER_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EACCES', 'EISDIR']);
const FIRST_WAIT_MS = 10;
const LONGEST_WAIT_MS = 250;

// Blocks the thread like studio-owner-lock's wait: the saves are synchronous, so nothing else may run in between.
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Whether a write failed because another program (Excel, a scanner, a sync agent) has the file open.
const isBusyError = (error) => BUSY_CODES.has(error?.code);

// On Windows: 10 ms, then doubling up to 250 ms between tries, about 2 s in all. When it still fails the temp file is
// removed (the caller's save failed; nothing half-written stays behind) and the last error is thrown.
function renameDurable(from, to, { platform = process.platform, fsImpl = fs, sleep = sleepSync, budgetMs = 2000 } = {}) {
  if (platform !== 'win32') return fsImpl.renameSync(from, to);
  let wait = FIRST_WAIT_MS; let waited = 0;
  for (;;) {
    try { return fsImpl.renameSync(from, to); }
    catch (error) {
      if (!isBusyError(error) || waited >= budgetMs) {
        try { fsImpl.unlinkSync(from); } catch (_) { /* already gone */ }
        throw error;
      }
      const pause = Math.min(wait, budgetMs - waited);
      sleep(pause); waited += pause; wait = Math.min(wait * 2, LONGEST_WAIT_MS);
    }
  }
}

// Atomic and durable: written to a private temp file of its own ('wx', so nothing already there is reused), flushed,
// renamed over the old file, then the folder is flushed. A crash or power cut leaves the previous file or the new one,
// never half of either; a failed save leaves no temp file. The caller makes the folder.
function writeFileDurable(target, data, { mode = 0o600, platform = process.platform, fsImpl = fs } = {}) {
  const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    const fd = fsImpl.openSync(temp, 'wx', mode);
    try { fsImpl.writeFileSync(fd, data); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
    renameDurable(temp, target, { platform, fsImpl });
  } catch (error) { try { fsImpl.unlinkSync(temp); } catch (_) { /* nothing was left behind */ } throw error; }
  let folder;
  try { folder = fsImpl.openSync(path.dirname(target), 'r'); fsImpl.fsyncSync(folder); }
  catch (error) { if (!FOLDER_SYNC_UNSUPPORTED.has(error.code)) throw error; }
  finally { if (folder != null) fsImpl.closeSync(folder); }
}

// An export saved over a file someone has open in Excel: on Windows Excel locks the file, so the export goes to the next
// free "<name> (2).csv" instead and that path is returned. Elsewhere (and for any other error) it writes as before.
function writeFileBesideBusy(filePath, data, { platform = process.platform, fsImpl = fs, maxCopies = 50 } = {}) {
  try { fsImpl.writeFileSync(filePath, data); return filePath; }
  catch (error) {
    if (platform !== 'win32' || !isBusyError(error)) throw error;
    const { dir, name, ext } = path.parse(filePath);
    for (let copy = 2; copy <= maxCopies; copy++) {
      const next = path.join(dir, `${name} (${copy})${ext}`);
      if (fsImpl.existsSync(next)) continue;
      try { fsImpl.writeFileSync(next, data); return next; } catch (nextError) { if (!isBusyError(nextError)) throw nextError; }
    }
    throw error;
  }
}

module.exports = { renameDurable, writeFileDurable, writeFileBesideBusy, isBusyError, sleepSync };
