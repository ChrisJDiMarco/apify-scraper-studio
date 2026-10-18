import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import ownership from '../src/main/studio-owner-lock.js';
const { acquireStudioOwnerLock } = ownership;
const roots = [], releases = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-owner-test-')); roots.push(root); return root; };
afterEach(() => { for (const release of releases.splice(0)) release(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('single-owner browser scheduler host', () => {
  it('rejects a second owner and allows reopening after a clean release', () => {
    const root = temp(); const release = acquireStudioOwnerLock(root); releases.push(release);
    expect(() => acquireStudioOwnerLock(root)).toThrow(/already open/);
    release(); const reopened = acquireStudioOwnerLock(root); releases.push(reopened);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.studio-owner.json'), 'utf8')).pid).toBe(process.pid);
  });
  it('recovers only a confirmed dead process and rejects unreadable ownership', () => {
    const root = temp(); const pid = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
    const target = path.join(root, '.studio-owner.json'); fs.writeFileSync(target, JSON.stringify({ pid, nonce: 'exited-owner' }));
    const release = acquireStudioOwnerLock(root); releases.push(release); expect(JSON.parse(fs.readFileSync(target, 'utf8')).pid).toBe(process.pid);
    release(); fs.writeFileSync(target, '{'); expect(() => acquireStudioOwnerLock(root)).toThrow(/unreadable/);
  });
  it('permits one winner when separate processes race to recover a stale owner', async () => {
    const root = temp(); const pid = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
    fs.writeFileSync(path.join(root, '.studio-owner.json'), JSON.stringify({ pid, nonce: 'dead-race-owner' }));
    const helper = path.resolve('src/main/studio-owner-lock.js');
    const code = `const {acquireStudioOwnerLock}=require(process.argv[1]);try{acquireStudioOwnerLock(process.argv[2]);console.log('owner');setTimeout(()=>process.exit(0),1000)}catch{console.log('blocked')}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', code, helper, root], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
      child.stdout.on('data', bytes => { output += bytes; }); child.on('error', reject); child.on('close', () => resolve(output.trim()));
    })));
    expect(results.filter(result => result === 'owner')).toHaveLength(1);
    expect(results.filter(result => result === 'blocked')).toHaveLength(7);
  });
  it('does not unlink a newer owner on cleanup', () => {
    const root = temp(); const release = acquireStudioOwnerLock(root); releases.push(release);
    fs.writeFileSync(path.join(root, '.studio-owner.json'), JSON.stringify({ pid: process.pid, nonce: 'new-owner' }));
    release(); expect(fs.existsSync(path.join(root, '.studio-owner.json'))).toBe(true);
  });
});

// A container's main process gets the same low PID on every start, and a killed server never runs its cleanup, so the
// lock it leaves can name this very process's PID, an unrelated process after a reboot, or another container.
describe('owner locks left by a killed server', () => {
  const { lockOwnerAlive, inspectOwnerLock, ownerLockHeld, releaseOnlyAtExit } = ownership;
  const lockFile = (root) => path.join(root, '.studio-owner.json');
  const write = (root, record) => fs.writeFileSync(lockFile(root), JSON.stringify(record));
  const read = (root) => JSON.parse(fs.readFileSync(lockFile(root), 'utf8'));

  it('takes over a lock that names this process’s own PID but was never taken by it (container PID 1 after a crash)', () => {
    const root = temp(); write(root, { pid: process.pid, nonce: 'previous-container', hostname: os.hostname(), heartbeatAt: Date.now() });
    const release = acquireStudioOwnerLock(root); releases.push(release);
    expect(read(root)).toMatchObject({ pid: process.pid, hostname: os.hostname(), heartbeatAt: expect.any(Number) });
    expect(read(root).nonce).not.toBe('previous-container');
    expect(() => acquireStudioOwnerLock(root)).toThrow(/already open/); // a lock this process holds still refuses a second owner
  });

  it('treats a live PID from before a reboot as gone, and a live PID in this boot as the owner', () => {
    const record = { pid: process.ppid, nonce: 'other', hostname: os.hostname(), boot: 'boot-before' };
    expect(lockOwnerAlive(record, { boot: 'boot-after' })).toBe(false);
    expect(lockOwnerAlive(record, { boot: 'boot-before' })).toBe(true);
    expect(lockOwnerAlive({ pid: process.ppid, nonce: 'legacy' })).toBe(true); // older records: the PID check, as before
  });

  it('watches another container’s recent heartbeat for a beat: a killed owner is taken over, an old one at once', () => {
    const killed = temp(); write(killed, { pid: 1, nonce: 'killed', hostname: 'old-container', heartbeatAt: Date.now() - 5000 });
    expect(inspectOwnerLock(killed).state).toBe('unsure');
    const started = Date.now(); const release = acquireStudioOwnerLock(killed, { observeMs: 400 }); releases.push(release);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350); expect(read(killed).nonce).not.toBe('killed');
    const old = temp(); write(old, { pid: 1, nonce: 'old', hostname: 'old-container', heartbeatAt: Date.now() - 10 * 60000 });
    expect(inspectOwnerLock(old).state).toBe('stale');
    releases.push(acquireStudioOwnerLock(old, { observeMs: 60000 })); // no wait: past the two-minute mark
  });

  it('refuses a data folder whose owner in another container is still beating', async () => {
    const root = temp(); write(root, { pid: 1, nonce: 'alive', hostname: 'other-container', heartbeatAt: Date.now() });
    // It beats the way a real owner does (studio-owner-lock.js): a temp file renamed over the lock, so a reader never
    // catches it half written (a plain writeFileSync truncates first, which reads as an unreadable lock under load).
    const script = `const fs=require('fs');const f=process.argv[1];setInterval(()=>{const r=JSON.parse(fs.readFileSync(f,'utf8'));r.heartbeatAt=Date.now();fs.writeFileSync(f+'.beat',JSON.stringify(r));fs.renameSync(f+'.beat',f);},100);setTimeout(()=>process.exit(0),4000);`;
    const beating = spawn(process.execPath, ['-e', script, lockFile(root)], { stdio: 'ignore' });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(() => acquireStudioOwnerLock(root, { observeMs: 1500 })).toThrow(/already open in another server \(on other-container\)/);
    } finally { beating.kill(); }
  });

  it('says whether this process still holds the lock, and can leave the release to process exit', () => {
    const root = temp(); expect(inspectOwnerLock(root).state).toBe('none');
    const release = acquireStudioOwnerLock(root); releases.push(release);
    expect(ownerLockHeld(root)).toBe(true); expect(inspectOwnerLock(root).state).toBe('held');
    releaseOnlyAtExit(true);
    try { release(); expect(fs.existsSync(lockFile(root))).toBe(true); } finally { releaseOnlyAtExit(false); }
    release(); expect(fs.existsSync(lockFile(root))).toBe(false); expect(ownerLockHeld(root)).toBe(false);
  });

  it('clears the collection locks an earlier process left, keeping this process’s and live ones', () => {
    const root = temp(); const collections = path.join(root, 'collections'); fs.mkdirSync(collections);
    const dead = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
    const lock = (name, record, mtime) => { const file = path.join(collections, `${name}.lock`); fs.writeFileSync(file, JSON.stringify(record)); if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000); return file; };
    const before = (Date.now() - process.uptime() * 1000 - 60000);
    const reused = lock('run-reused', { pid: process.pid, nonce: 'previous' }, before); const exited = lock('run-exited', { pid: dead, nonce: 'gone' });
    const mine = lock('run-mine', { pid: process.pid, nonce: 'current' }); const other = lock('run-other', { pid: process.ppid, nonce: 'live' });
    releases.push(acquireStudioOwnerLock(root));
    expect([reused, exited].map((file) => fs.existsSync(file))).toEqual([false, false]);
    expect([mine, other].map((file) => fs.existsSync(file))).toEqual([true, true]);
  });

  it('clears a recovery marker a crash left behind mid-recovery', () => {
    const root = temp(); const marker = path.join(root, '.studio-owner-recovery'); fs.mkdirSync(marker);
    const old = (Date.now() - 5 * 60000) / 1000; fs.utimesSync(marker, old, old);
    const dead = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
    write(root, { pid: dead, nonce: 'dead' });
    releases.push(acquireStudioOwnerLock(root));
    expect(fs.existsSync(marker)).toBe(false); expect(read(root).pid).toBe(process.pid);
  });
});
