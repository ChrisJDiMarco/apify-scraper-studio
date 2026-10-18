import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ownership from '../src/main/studio-owner-lock.js';
import hostModule from '../src/main/studio-host.js';

// Windows reuses PIDs quickly, has no boot id, and ends a sign-out or restart without the app's quit events, so the lock
// a desktop app leaves can name a live, unrelated process on the next launch. The installed desktop app (desktop: true,
// passed only after it has won Electron's single-instance lock) takes over a lock another desktop process left on this
// machine. Dev runs, the web server and 0.3.0 write no flag, and their locks keep the PID check.
const { acquireStudioOwnerLock, clearStaleCollectionLocks } = ownership;
const { createStudioHost } = hostModule;
const roots = [], releases = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'win-owner-lock-')); roots.push(root); return root; };
afterEach(() => { for (const release of releases.splice(0)) release(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const lockFile = (root) => path.join(root, '.studio-owner.json');
const write = (root, record) => fs.writeFileSync(lockFile(root), JSON.stringify(record));
const read = (root) => JSON.parse(fs.readFileSync(lockFile(root), 'utf8'));
const deadPid = () => Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
const beforeThisProcess = () => Date.now() - process.uptime() * 1000 - 60000;
// A lock a desktop app left at a crash or a Windows restart, whose PID now names a live process (here, vitest's parent).
const leftover = (extra = {}) => ({ pid: process.ppid, nonce: 'desktop-before-restart', hostname: os.hostname(), desktop: true, startedAt: Date.now() - 3600000, heartbeatAt: Date.now(), ...extra });

describe('the desktop owner lock', () => {
  it('lets the installed desktop app take over a lock another desktop process left on this machine, even with a live PID', () => {
    const root = temp(); write(root, leftover());
    expect(() => acquireStudioOwnerLock(root)).toThrow(/already open/); // without the flag: the PID check, which says alive
    const release = acquireStudioOwnerLock(root, { desktop: true }); releases.push(release);
    expect(read(root)).toMatchObject({ pid: process.pid, hostname: os.hostname(), desktop: true });
    expect(read(root).nonce).not.toBe('desktop-before-restart');
    release(); expect(fs.existsSync(lockFile(root))).toBe(false);
  });

  it('never takes a dev run’s, the web server’s or a 0.3.0 lock (no flag) while its PID is live', () => {
    const root = temp(); write(root, { pid: process.ppid, nonce: 'dev-run', hostname: os.hostname(), heartbeatAt: Date.now() });
    expect(() => acquireStudioOwnerLock(root, { desktop: true })).toThrow(/already open/);
    write(root, { pid: process.ppid, nonce: 'older-desktop' }); // 0.3.0 wrote no hostname or flag
    expect(() => acquireStudioOwnerLock(root, { desktop: true })).toThrow(/already open/);
    expect(read(root).nonce).toBe('older-desktop');
    const dead = temp(); write(dead, { pid: deadPid(), nonce: 'older-desktop-exited' }); // a dead PID is still recovered, as before
    releases.push(acquireStudioOwnerLock(dead, { desktop: true })); expect(read(dead).pid).toBe(process.pid);
  });

  it('writes the flag only for the desktop app, and never takes over a lock this process holds', () => {
    const dev = temp(); releases.push(acquireStudioOwnerLock(dev)); expect(read(dev)).not.toHaveProperty('desktop');
    const desktop = temp(); releases.push(acquireStudioOwnerLock(desktop, { desktop: true })); expect(read(desktop).desktop).toBe(true);
    expect(() => acquireStudioOwnerLock(desktop, { desktop: true })).toThrow(/already open/);
  });

  // WSL takes the Windows computer name as its hostname, so a server in WSL and the Windows app share a hostname but not
  // PIDs: a PID from the other system says nothing about whether its owner is alive.
  it('watches the heartbeat of a lock from another system with the same hostname instead of probing its PID', () => {
    const other = process.platform === 'win32' ? 'linux' : 'win32';
    const record = { pid: deadPid(), nonce: 'wsl-server', hostname: os.hostname(), platform: other, heartbeatAt: Date.now() };
    expect(ownership.lockOwnerAlive(record)).toBeNull();
    expect(ownership.lockOwnerAlive({ ...record, heartbeatAt: Date.now() - ownership.STALE_MS - 1000 })).toBe(false);
    expect(ownership.lockOwnerAlive({ ...record, platform: process.platform })).toBe(false); // this system: the PID decides
    expect(ownership.lockOwnerAlive({ pid: deadPid(), nonce: 'older', hostname: os.hostname() })).toBe(false); // no platform: as before
    // Taken over only after its heartbeat was watched for a beat and didn't move (a live owner's would).
    const root = temp(); write(root, record);
    const started = Date.now(); releases.push(acquireStudioOwnerLock(root, { observeMs: 400 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    const mine = temp(); releases.push(acquireStudioOwnerLock(mine)); expect(read(mine).platform).toBe(process.platform);
  });

  it('treats a desktop lock from another machine as before: its heartbeat is watched, not trusted to be stale', () => {
    const root = temp(); write(root, leftover({ pid: 1, hostname: 'other-machine', heartbeatAt: Date.now() - 5000 }));
    const started = Date.now(); releases.push(acquireStudioOwnerLock(root, { desktop: true, observeMs: 400 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(350); // watched for a beat first
    expect(read(root)).toMatchObject({ pid: process.pid, desktop: true });
  });
});

describe('collection locks at a desktop launch', () => {
  const lock = (root, name, record, mtime) => {
    const file = path.join(root, 'collections', `${name}.lock`); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record));
    if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };

  it('removes every lock from before this process started, live PID or unreadable, and keeps newer ones', () => {
    const root = temp(); const old = beforeThisProcess();
    const reusedPid = lock(root, 'run-reused', { pid: process.ppid, nonce: 'before-restart' }, old);
    const truncated = lock(root, 'run-truncated', '', old);
    const current = lock(root, 'run-current', { pid: process.ppid, nonce: 'live-now' });
    clearStaleCollectionLocks(root); // a dev run or the web server: a live PID's lock stays
    expect([reusedPid, truncated, current].map((file) => fs.existsSync(file))).toEqual([true, true, true]);
    clearStaleCollectionLocks(root, { desktop: true });
    expect([reusedPid, truncated, current].map((file) => fs.existsSync(file))).toEqual([false, false, true]);
  });

  it('clears them when the desktop app takes the owner lock', () => {
    const root = temp(); write(root, leftover());
    const reusedPid = lock(root, 'run-reused', { pid: process.ppid, nonce: 'before-restart' }, beforeThisProcess());
    releases.push(acquireStudioOwnerLock(root, { desktop: true }));
    expect(fs.existsSync(reusedPid)).toBe(false);
  });
});

// acquireCollectionLock (studio-host.js): a lock that names this process's own PID is live only when it was written
// since this process started, as clearStaleCollectionLocks reads it. Another host in this same process still refuses.
describe('reserving a collection', () => {
  const program = { id: 'program-a', name: 'Research fixture', sourceGroups: [{ id: 'source-x', platform: 'x', targets: ['author1'] }], targetPerPlatform: 20, budgets: { collectionUsd: 0.1, aiUsd: 1 } };
  class Client {
    actor(actorId) { return { start: async () => ({ id: 'provider-1', actorId, status: 'SUCCEEDED', defaultDatasetId: 'data-1', usageTotalUsd: 0.001 }) }; }
    run(id) { return { get: async () => ({ id, status: 'SUCCEEDED', defaultDatasetId: 'data-1', usageTotalUsd: 0.001 }), abort: async () => null }; }
    dataset() { return { listItems: async ({ offset, limit }) => { const items = [{ id: 'post-1', text: 'Evidence', author: 'author1', url: 'https://x.com/author1/status/123', createdAt: '2026-09-20T12:00:00Z', likeCount: 10 }]; return { items: items.slice(offset, offset + limit), count: Math.min(items.length - offset, limit), total: items.length }; } }; }
  }
  const collect = (root) => createStudioHost({ root, getApifyToken: () => 'fixture-only-token', Client, runnerOptions: { pollIntervalMs: 0, pollBackoffMs: 0, downloadBackoffMs: 0 } })
    .collect({ program, runId: 'research-a', workspaceId: 'semrush', isCancelled: () => false, onProgress: () => {} });
  const lockAt = (root, record, mtime) => {
    const file = path.join(root, 'collections', 'research-a.lock'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record)); if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000); return file;
  };

  it('takes over a lock an earlier process left under this process’s PID (Windows after a restart)', async () => {
    const root = temp(); const file = lockAt(root, { pid: process.pid, nonce: 'earlier-process' }, beforeThisProcess());
    await expect(collect(root)).resolves.toMatchObject({ receipt: expect.objectContaining({ succeededJobs: 1 }) });
    expect(fs.existsSync(file)).toBe(false); // released after the run
  });

  it('refuses while this process or another live one holds it, and recovers a dead one', async () => {
    const mine = temp(); lockAt(mine, { pid: process.pid, nonce: 'another-host-in-this-process' });
    await expect(collect(mine)).rejects.toThrow(/already active/);
    const live = temp(); lockAt(live, { pid: process.ppid, nonce: 'live-process' });
    await expect(collect(live)).rejects.toThrow(/already active/);
    const dead = temp(); lockAt(dead, { pid: deadPid(), nonce: 'exited' });
    await expect(collect(dead)).resolves.toMatchObject({ receipt: expect.objectContaining({ succeededJobs: 1 }) });
  });
});
