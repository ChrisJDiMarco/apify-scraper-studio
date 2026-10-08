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
