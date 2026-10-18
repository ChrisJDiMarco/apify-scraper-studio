const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
// A browser host is a single-owner process. Lock before reading/recovering state,
// since opening a second server on another port must never create another worker.
//
// The record names the process (pid), this acquisition (nonce), the machine or container (hostname), the boot it runs
// in, and a heartbeat the owner refreshes. A PID alone can't prove an owner is alive: a container's main process is
// PID 1 (or the same low PID under tini) on every start, so after a SIGKILL or an OOM kill the leftover lock names the
// new process's own PID, and after a host reboot it can name an unrelated process.
const HEARTBEAT_MS = 30000;
const STALE_MS = 120000; // an owner on another host that hasn't refreshed for this long is gone, without watching
const RECOVERY_STALE_MS = 30000; // recovery takes milliseconds; an older marker was left by a crash mid-recovery
const LOCK_FILE = '.studio-owner.json';
const held = new Map(); // realpath(root) → nonce, for locks this process holds
let releaseAtExitOnly = false;

let cachedBoot;
// Changes on every boot of the machine (shared by the containers on one host, so only trusted with a matching hostname).
function bootId() {
  if (cachedBoot !== undefined) return cachedBoot;
  try { cachedBoot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch (_) { cachedBoot = ''; }
  return cachedBoot;
}
const keyFor = (root) => { try { return fs.realpathSync(root); } catch (_) { return path.resolve(root); } };
const heldNonce = (nonce) => [...held.values()].includes(nonce);
function probe(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } } // EPERM: alive, someone else's

// Whether a lock record (owner or collection) may still belong to a live process: true, false, or null when this host
// can't tell (another machine or container whose heartbeat is recent; watch it for a beat to decide). Exported for the
// backup and restore scripts.
// A record's platform tells WSL from the Windows it runs on: they share the computer name but not PIDs.
function lockOwnerAlive(record, { now = Date.now(), hostname = os.hostname(), boot = bootId(), pid = process.pid, platform = process.platform, isHeld = heldNonce } = {}) {
  if (!record || !Number.isInteger(record.pid) || record.pid < 1) return false;
  if (typeof record.nonce === 'string' && isHeld(record.nonce)) return true; // ours, still held
  // Older records carry no hostname or platform: same host, as before.
  const sameHost = (!record.hostname || record.hostname === hostname) && (!record.platform || record.platform === platform);
  if (!sameHost) return Number.isFinite(record.heartbeatAt) && now - record.heartbeatAt < STALE_MS ? null : false; // its PID means nothing here
  if (record.pid === pid) return false; // our own PID, but not a lock we took: an earlier process (container PID 1 after a crash)
  if (record.boot && boot && record.boot !== boot) return false; // the machine rebooted since; that process is gone
  return probe(record.pid);
}
// A recent heartbeat from another host or container: a live owner refreshes it within HEARTBEAT_MS, a killed one never
// does. Returns 'alive', 'dead' or 'gone' (the lock was removed meanwhile).
function watchHeartbeat(target, owner, ms) {
  const pause = new Int32Array(new SharedArrayBuffer(4)); const until = Date.now() + ms;
  while (Date.now() < until) {
    Atomics.wait(pause, 0, 0, Math.min(1000, Math.max(1, until - Date.now())));
    let current; try { current = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return 'gone'; continue; }
    if (current.nonce !== owner.nonce || current.heartbeatAt !== owner.heartbeatAt) return 'alive';
  }
  return 'dead';
}

// What a data folder's owner lock says: { state: 'none' | 'held' | 'live' | 'stale' | 'unreadable', owner }.
function inspectOwnerLock(root) {
  const target = path.join(root, LOCK_FILE);
  let owner;
  try { owner = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { return { state: error.code === 'ENOENT' ? 'none' : 'unreadable', owner: null }; }
  if (owner?.nonce && held.get(keyFor(root)) === owner.nonce) return { state: 'held', owner };
  const alive = lockOwnerAlive(owner);
  return { state: alive === null ? 'unsure' : alive ? 'live' : 'stale', owner };
}
// True while this process still holds the lock on `root` (the readiness check).
const ownerLockHeld = (root) => inspectOwnerLock(root).state === 'held';

// A collection lock (collections/<runId>.lock) belongs to the folder's owner. When this process takes ownership, one
// left by an earlier process can't be live: it carries a dead PID, or our own PID from before this process started.
// The packaged desktop app (desktop) removes every one from before it started, readable or not: no other process can
// own its folder, and on Windows a PID left by a crash or a restart can name a live, unrelated process.
function clearStaleCollectionLocks(root, { desktop = false } = {}) {
  const dir = path.join(root, 'collections'); let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  const startedAt = Date.now() - process.uptime() * 1000;
  for (const name of names.filter((entry) => entry.endsWith('.lock'))) {
    const file = path.join(dir, name);
    try {
      const earlier = fs.statSync(file).mtimeMs < startedAt;
      if (desktop && earlier) { fs.unlinkSync(file); continue; }
      const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
      if ((lock.pid === process.pid && earlier) || (lock.pid !== process.pid && lockOwnerAlive(lock) === false)) fs.unlinkSync(file);
    } catch (_) { /* unreadable or already gone: the collection reports it on retry */ }
  }
}
// The packaged desktop app runs once per person and machine (Electron's single-instance lock, which it holds before it
// asks for this one), so a lock another desktop process left on this machine is stale whatever its PID now names:
// Windows reuses PIDs after a restart, has no boot id, and ends a session without running the app's cleanup. Dev runs
// and the web server share the folder but write no flag, so their locks are never taken this way; neither are locks
// from 0.3.0 and earlier, which keep the PID check.
const desktopLeftover = (record, desktop) => desktop && record?.desktop === true && !heldNonce(record.nonce) && (!record.hostname || record.hostname === os.hostname()) && (!record.platform || record.platform === process.platform);

// The web server releases the lock only when the process exits, after aborted work has written its last state.
function releaseOnlyAtExit(on = true) { releaseAtExitOnly = Boolean(on); }

// observeMs: how long to watch another host's recent heartbeat before calling its owner dead (tests shorten it).
// desktop: only the packaged desktop app, after it has won Electron's single-instance lock (see desktopLeftover).
function acquireStudioOwnerLock(root, { observeMs = HEARTBEAT_MS + 10000, desktop = false } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('Studio storage is required.');
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, LOCK_FILE); const key = keyFor(root);
  const record = { pid: process.pid, nonce: randomUUID(), hostname: os.hostname(), platform: process.platform, boot: bootId(), startedAt: Date.now(), heartbeatAt: Date.now(), ...(desktop ? { desktop: true } : {}) };
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      fd = fs.openSync(target, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      held.set(key, record.nonce);
      clearStaleCollectionLocks(root, { desktop });
      // The heartbeat lets a server on another host or container tell a live owner from one that was killed.
      const beat = setInterval(() => {
        try {
          const current = JSON.parse(fs.readFileSync(target, 'utf8'));
          if (current.nonce !== record.nonce) { clearInterval(beat); held.delete(key); console.error(JSON.stringify({ at: new Date().toISOString(), level: 'error', event: 'owner-lock-lost' })); return; }
          const temp = `${target}.${process.pid}.beat`;
          fs.writeFileSync(temp, JSON.stringify({ ...record, heartbeatAt: Date.now() }), { mode: 0o600 }); fs.renameSync(temp, target);
        } catch (_) { /* a missed beat; the next one tries again */ }
      }, HEARTBEAT_MS);
      beat.unref();
      let released = false;
      const drop = () => {
        if (released) return; released = true; clearInterval(beat); process.removeListener('exit', drop);
        if (held.get(key) === record.nonce) held.delete(key);
        try { const owner = JSON.parse(fs.readFileSync(target, 'utf8')); if (owner.pid === record.pid && owner.nonce === record.nonce) fs.unlinkSync(target); }
        catch (error) { if (error.code !== 'ENOENT') console.error('Studio ownership cleanup:', error.code || 'Unreadable lock'); }
      };
      process.once('exit', drop);
      return () => { if (!releaseAtExitOnly) drop(); };
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(target, 'utf8')); }
      catch (readError) { if (readError.code === 'ENOENT') continue; throw new Error('Studio ownership is being established or its lock is unreadable. Close the other server before trying again.'); }
      if (!Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.nonce !== 'string') throw new Error('Studio ownership lock is invalid. Check that no server is running before repairing it.');
      let alive = desktopLeftover(owner, desktop) ? false : lockOwnerAlive(owner);
      if (alive === null) { const seen = watchHeartbeat(target, owner, observeMs); if (seen === 'gone') continue; alive = seen === 'alive'; }
      if (!alive) {
        // Serialize stale-lock removal. Without this guard two starters could
        // both observe a dead owner and one could unlink the other's new lock.
        const recovery = path.join(root, '.studio-owner-recovery');
        try { fs.mkdirSync(recovery, { mode: 0o700 }); }
        catch (lockError) {
          if (lockError.code !== 'EEXIST') throw lockError;
          let age = 0; try { age = Date.now() - fs.statSync(recovery).mtimeMs; } catch (_) { continue; }
          if (age > RECOVERY_STALE_MS) { try { fs.rmdirSync(recovery); } catch (_) { /* another starter removed it */ } continue; }
          throw new Error('Studio ownership recovery is already in progress. If the previous server crashed during recovery, verify no server is running before removing .studio-owner-recovery.');
        }
        try {
          const current = JSON.parse(fs.readFileSync(target, 'utf8'));
          if (current.pid === owner.pid && current.nonce === owner.nonce && current.heartbeatAt === owner.heartbeatAt && (desktopLeftover(current, desktop) || lockOwnerAlive(current) !== true)) fs.unlinkSync(target);
        } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
        finally { fs.rmdirSync(recovery); }
        continue;
      }
      const elsewhere = owner.hostname && owner.hostname !== os.hostname();
      throw new Error(`This studio data folder is already open in another server${elsewhere ? ` (on ${owner.hostname})` : ''}. Stop that server or choose a different STUDIO_DATA_DIR. If no server is using it, delete ${target} and start again.`);
    }
  }
  throw new Error('Another server claimed this studio data folder. Try again after it closes.');
}
module.exports = { acquireStudioOwnerLock, releaseOnlyAtExit, ownerLockHeld, inspectOwnerLock, lockOwnerAlive, clearStaleCollectionLocks, LOCK_FILE, STALE_MS };
