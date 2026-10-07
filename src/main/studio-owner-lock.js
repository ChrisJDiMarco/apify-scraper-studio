const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
// A browser host is a single-owner process. Lock before reading/recovering state,
// since opening a second server on another port must never create another worker.
function acquireStudioOwnerLock(root) {
  if (typeof root !== 'string' || !root) throw new Error('Studio storage is required.');
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, '.studio-owner.json');
  const record = { pid: process.pid, nonce: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      fd = fs.openSync(target, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      let released = false;
      const release = () => {
        if (released) return; released = true; process.removeListener('exit', release);
        try { const owner = JSON.parse(fs.readFileSync(target, 'utf8')); if (owner.pid === record.pid && owner.nonce === record.nonce) fs.unlinkSync(target); }
        catch (error) { if (error.code !== 'ENOENT') console.error('Studio ownership cleanup:', error.code || 'Unreadable lock'); }
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(target, 'utf8')); }
      catch (readError) { if (readError.code === 'ENOENT') continue; throw new Error('Studio ownership is being established or its lock is unreadable. Close the other server before trying again.'); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.nonce !== 'string') throw new Error('Studio ownership lock is invalid. Check that no server is running before repairing it.');
      try { process.kill(owner.pid, 0); }
      catch (status) {
        if (status.code === 'ESRCH') {
          // Serialize stale-lock removal. Without this guard two starters could
          // both observe a dead PID and one could unlink the other's new lock.
          const recovery = path.join(root, '.studio-owner-recovery');
          try { fs.mkdirSync(recovery, { mode: 0o700 }); }
          catch (lockError) { if (lockError.code === 'EEXIST') throw new Error('Studio ownership recovery is already in progress. If the previous server crashed during recovery, verify no server is running before removing .studio-owner-recovery.'); throw lockError; }
          try {
            const current = JSON.parse(fs.readFileSync(target, 'utf8'));
            if (current.pid === owner.pid && current.nonce === owner.nonce) {
              try { process.kill(current.pid, 0); }
              catch (stillDead) { if (stillDead.code === 'ESRCH') fs.unlinkSync(target); }
            }
          } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
          finally { fs.rmdirSync(recovery); }
          continue;
        }
      }
      throw new Error('This studio data folder is already open in another server. Stop that server or choose a different STUDIO_DATA_DIR.');
    }
  }
  throw new Error('Another server claimed this studio data folder. Try again after it closes.');
}
module.exports = { acquireStudioOwnerLock };
