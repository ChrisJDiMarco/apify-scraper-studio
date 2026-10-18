import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// scripts/studio-backup.cjs and scripts/studio-restore.cjs: a backup that leaves out what must not travel, and a
// restore that checks everything before it moves the current data aside.
const require = createRequire(import.meta.url);
const { backup, prune } = require('../scripts/studio-backup.cjs');
const { restore } = require('../scripts/studio-restore.cjs');
const ownership = require('../src/main/studio-owner-lock.js');
const roots = []; const releases = [];
afterEach(() => { for (const release of releases.splice(0)) release(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const quiet = () => {};
function seed() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backup-test-')); roots.push(root);
  const data = path.join(root, 'data'); const put = (rel, text) => { const file = path.join(data, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  put('data.json', '{"datasets":[]}'); put('config.json', '{"keys":{}}');
  put('content-studio/team.json', JSON.stringify({ version: 2, members: [{ id: 'member-alex', name: 'Alex' }] }));
  put('content-studio/state.json', '{"version":1,"researchRuns":[]}');
  put('content-studio/runs/run-1/report.md', '# Trends');
  const exited = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
  put('content-studio/.studio-owner.json', JSON.stringify({ pid: exited, nonce: 'left-by-a-crash' })); // stale: not copied, not "running"
  put('content-studio/state.json.123.tmp', 'partial');
  put('web-transfers/saves/call-1/setup.json', 'apify_api_fixture');
  return { root, data, out: path.join(root, 'backups') };
}

describe('studio backups', () => {
  it('backs up the data folder with a checksum per file, leaving out transfers, the lock and temporary files', () => {
    const { data, out } = seed();
    const made = backup({ dataDir: data, outDir: out, log: quiet });
    expect(made.path).toMatch(/scraper-studio-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz$/);
    if (process.platform !== 'win32') expect(fs.statSync(made.path).mode & 0o777).toBe(0o600);
    expect(made.manifest).toMatchObject({ format: 'scraper-studio-backup', formatVersion: 1, server: 'stopped', settled: true, versions: { team: 2, contentState: 1 } });
    expect(made.manifest.files.map((file) => file.path)).toEqual(['config.json', 'content-studio/runs/run-1/report.md', 'content-studio/state.json', 'content-studio/team.json', 'data.json']);
    expect(made.manifest.files[0]).toEqual({ path: 'config.json', size: 11, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const listing = execFileSync('tar', ['-tzf', path.basename(made.path)], { cwd: path.dirname(made.path), encoding: 'utf8' }); // no drive letter in -f
    expect(listing).not.toMatch(/web-transfers|studio-owner|\.tmp/);
    expect(fs.readdirSync(out)).toEqual([path.basename(made.path)]); // no work folder left behind
  });

  it('notes a backup taken while a server holds the folder, and keeps only the newest backups when asked', () => {
    const { data, out } = seed(); fs.rmSync(path.join(data, 'content-studio', '.studio-owner.json'));
    releases.push(ownership.acquireStudioOwnerLock(path.join(data, 'content-studio')));
    const times = [1, 2, 3].map((minute) => new Date(Date.UTC(2026, 9, 17, 12, minute)));
    const made = times.map((now) => backup({ dataDir: data, outDir: out, now, archive: false, keep: 2, log: quiet }));
    expect(made[0].manifest.server).toBe('running');
    expect(fs.readdirSync(out).sort()).toEqual(['scraper-studio-backup-2026-10-17T12-02-00-000Z', 'scraper-studio-backup-2026-10-17T12-03-00-000Z']);
    expect(prune(out, undefined)).toEqual([]);
  });
});

describe('studio restores', () => {
  it('checks a backup without changing anything unless told to, then keeps the old data to undo', () => {
    const { root, data, out } = seed(); const made = backup({ dataDir: data, outDir: out, log: quiet });
    const target = path.join(root, 'target'); fs.mkdirSync(path.join(target, 'content-studio'), { recursive: true }); fs.writeFileSync(path.join(target, 'data.json'), '{"current":true}');
    expect(restore({ from: made.path, dataDir: target, log: quiet }).restored).toBe(false);
    expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe('{"current":true}');
    expect(fs.readdirSync(target).filter((entry) => entry.startsWith('.'))).toEqual([]);
    const done = restore({ from: made.path, dataDir: target, yes: true, log: quiet });
    expect(done.restored).toBe(true);
    expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe('{"datasets":[]}');
    expect(fs.readFileSync(path.join(target, 'content-studio', 'runs', 'run-1', 'report.md'), 'utf8')).toBe('# Trends');
    expect(fs.readFileSync(path.join(done.aside, 'data.json'), 'utf8')).toBe('{"current":true}');
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o700);
  });

  it('refuses while a server holds the data folder', () => {
    const { root, data, out } = seed(); const made = backup({ dataDir: data, outDir: out, log: quiet });
    const target = path.join(root, 'target'); releases.push(ownership.acquireStudioOwnerLock(path.join(target, 'content-studio')));
    expect(() => restore({ from: made.path, dataDir: target, yes: true, log: quiet })).toThrow(/A studio server is using/);
  });

  it('refuses a backup whose files changed, or one from a newer studio', () => {
    const { root, data, out } = seed(); const made = backup({ dataDir: data, outDir: out, archive: false, log: quiet });
    const tampered = path.join(root, 'tampered'); fs.cpSync(made.path, tampered, { recursive: true });
    fs.writeFileSync(path.join(tampered, 'data', 'data.json'), '{"datasets":["edited"]}'); fs.writeFileSync(path.join(tampered, 'data', 'extra.json'), '{}');
    expect(() => restore({ from: tampered, dataDir: path.join(root, 'a'), log: quiet })).toThrow(/changed since the backup: data\.json[\s\S]*not in the manifest: extra\.json/);
    const newer = path.join(root, 'newer'); fs.cpSync(made.path, newer, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(newer, 'manifest.json'), 'utf8')); manifest.versions.team = 99;
    fs.writeFileSync(path.join(newer, 'manifest.json'), JSON.stringify(manifest));
    expect(() => restore({ from: newer, dataDir: path.join(root, 'b'), log: quiet })).toThrow(/team file is version 99, newer than this studio reads/);
    expect(fs.existsSync(path.join(root, 'b', 'data.json'))).toBe(false);
  });

  // On Windows a bare "tar" is looked up in the working folder before PATH, so a tar.exe sitting beside a downloaded
  // backup would run. tar never starts from the backup's folder, and Windows' own tar is named by its full path.
  it('never starts tar from the backup’s folder, and names Windows’ own tar on Windows', () => {
    const { root, data, out } = seed(); const made = backup({ dataDir: data, outDir: out, log: quiet });
    const childProcess = require('child_process'); const spy = vi.spyOn(childProcess, 'execFileSync');
    const script = require.resolve('../scripts/studio-restore.cjs'); delete require.cache[script];
    try {
      expect(require('../scripts/studio-restore.cjs').restore({ from: made.path, dataDir: path.join(root, 'd'), log: quiet }).restored).toBe(false);
      const tarCalls = spy.mock.calls.filter(([command]) => /(^|[\\/])tar(\.exe)?$/i.test(command));
      expect(tarCalls).toHaveLength(3); // two listings, one unpack
      for (const [, , options] of tarCalls) expect(options?.cwd).not.toBe(path.dirname(made.path));
    } finally { spy.mockRestore(); delete require.cache[script]; }
    const { tarCommand } = require('../scripts/studio-backup.cjs');
    expect(tarCommand('win32', { SystemRoot: 'D:\\Windows' })).toBe('D:\\Windows\\System32\\tar.exe');
    expect(tarCommand('win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
    expect(tarCommand('darwin', { SystemRoot: 'C:\\Windows' })).toBe('tar');
  });

  it.runIf(process.platform !== 'win32')('won’t unpack an archive that holds links', () => {
    const { root } = seed(); const evil = path.join(root, 'evil'); fs.mkdirSync(path.join(evil, 'backup', 'data'), { recursive: true });
    fs.writeFileSync(path.join(evil, 'backup', 'manifest.json'), JSON.stringify({ format: 'scraper-studio-backup', formatVersion: 1, files: [] }));
    fs.symlinkSync('/etc', path.join(evil, 'backup', 'data', 'escape'));
    const archive = path.join(root, 'evil.tar.gz'); execFileSync('tar', ['-czf', archive, '-C', evil, 'backup']);
    expect(() => restore({ from: archive, dataDir: path.join(root, 'c'), yes: true, log: quiet })).toThrow(/holds links or special files/);
    expect(fs.readdirSync(path.join(root, 'c'))).toEqual([]);
  });
});
