import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import durable from '../src/shared/durable-write.js';
const { renameDurable, writeFileDurable, writeFileBesideBusy, isBusyError } = durable;

// Saves on Windows (src/shared/durable-write.js): a rename over a file a scanner or sync agent holds is retried for about
// two seconds; elsewhere it is a plain rename. An export over a file open in Excel goes beside it on Windows.
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-write-')); roots.push(root); return root; };
const busy = (code = 'EBUSY') => Object.assign(new Error(`${code}: resource busy or locked, rename`), { code });

// An fs whose renameSync throws the given errors first, then succeeds; it records every call.
function fakeFs(...errors) {
  const calls = { rename: 0, unlinked: [] };
  return { calls, renameSync: () => { calls.rename++; if (errors.length) throw errors.shift(); }, unlinkSync: (file) => { calls.unlinked.push(file); } };
}

describe('renameDurable', () => {
  it('on Windows, waits 10 ms then 20 ms and succeeds when the file is free on the third try', () => {
    const fsImpl = fakeFs(busy(), busy()); const sleeps = [];
    renameDurable('a.tmp', 'a.json', { platform: 'win32', fsImpl, sleep: (ms) => sleeps.push(ms) });
    expect(sleeps).toEqual([10, 20]);
    expect(fsImpl.calls.rename).toBe(3); expect(fsImpl.calls.unlinked).toEqual([]);
  });

  it('retries EPERM and EACCES the same way', () => {
    const fsImpl = fakeFs(busy('EPERM'), busy('EACCES')); const sleeps = [];
    renameDurable('a.tmp', 'a.json', { platform: 'win32', fsImpl, sleep: (ms) => sleeps.push(ms) });
    expect(sleeps).toEqual([10, 20]);
  });

  it('on the Mac throws at once, without waiting or touching the temp file', () => {
    const fsImpl = fakeFs(busy()); const sleeps = [];
    expect(() => renameDurable('a.tmp', 'a.json', { platform: 'darwin', fsImpl, sleep: (ms) => sleeps.push(ms) })).toThrow('EBUSY');
    expect(sleeps).toEqual([]); expect(fsImpl.calls.rename).toBe(1); expect(fsImpl.calls.unlinked).toEqual([]);
  });

  it('gives up when the budget runs out, removes the temp file and throws the last error', () => {
    const fsImpl = fakeFs(...Array.from({ length: 40 }, () => busy())); const sleeps = [];
    expect(() => renameDurable('a.tmp', 'a.json', { platform: 'win32', fsImpl, sleep: (ms) => sleeps.push(ms) })).toThrow('EBUSY');
    expect(sleeps.slice(0, 6)).toEqual([10, 20, 40, 80, 160, 250]); // doubling, then 250 ms at most
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(2000);
    expect(fsImpl.calls.unlinked).toEqual(['a.tmp']);
  });

  it('throws any other error at once on Windows, removing the temp file', () => {
    const fsImpl = fakeFs(busy('ENOSPC')); const sleeps = [];
    expect(() => renameDurable('a.tmp', 'a.json', { platform: 'win32', fsImpl, sleep: (ms) => sleeps.push(ms) })).toThrow('ENOSPC');
    expect(sleeps).toEqual([]); expect(fsImpl.calls.unlinked).toEqual(['a.tmp']);
  });
});

describe('writeFileDurable', () => {
  it('replaces the file atomically, private to this user, and leaves no temp file', () => {
    const root = temp(); const target = path.join(root, 'state.json');
    fs.writeFileSync(target, 'old');
    writeFileDurable(target, '{"saved":true}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"saved":true}');
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(root)).toEqual(['state.json']);
  });

  it('keeps the old file and removes the temp file when the rename fails', () => {
    const root = temp(); const target = path.join(root, 'state.json'); fs.writeFileSync(target, 'old');
    const fsImpl = { ...fs, renameSync: () => { throw busy('ENOSPC'); } };
    expect(() => writeFileDurable(target, 'new', { platform: 'darwin', fsImpl })).toThrow('ENOSPC');
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
    expect(fs.readdirSync(root)).toEqual(['state.json']);
  });

  it('on Windows, saves once the scanner lets go of the file', () => {
    const root = temp(); const target = path.join(root, 'state.json'); let refusals = 1;
    const fsImpl = { ...fs, renameSync: (from, to) => { if (refusals-- > 0) throw busy(); return fs.renameSync(from, to); } };
    writeFileDurable(target, 'new', { platform: 'win32', fsImpl });
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(fs.readdirSync(root)).toEqual(['state.json']);
  });
});

describe('writeFileBesideBusy', () => {
  // Excel on Windows locks the CSV it has open: writing over it fails with EBUSY.
  const lockedFs = (locked) => ({ ...fs, writeFileSync: (file, ...rest) => { if (locked.includes(String(file))) throw busy(); return fs.writeFileSync(file, ...rest); } });

  it('on Windows, writes "<name> (2).csv" beside a file open in Excel and returns that path', () => {
    const root = temp(); const target = path.join(root, 'Posts.csv'); fs.writeFileSync(target, 'open in Excel');
    const written = writeFileBesideBusy(target, 'a,b\n1,2', { platform: 'win32', fsImpl: lockedFs([target]) });
    expect(written).toBe(path.join(root, 'Posts (2).csv'));
    expect(fs.readFileSync(written, 'utf8')).toBe('a,b\n1,2'); expect(fs.readFileSync(target, 'utf8')).toBe('open in Excel');
  });

  it('skips copies that already exist or are open too', () => {
    const root = temp(); const target = path.join(root, 'Posts.csv'); const second = path.join(root, 'Posts (2).csv');
    fs.writeFileSync(second, 'an earlier export');
    expect(writeFileBesideBusy(target, 'rows', { platform: 'win32', fsImpl: lockedFs([target]) })).toBe(path.join(root, 'Posts (3).csv'));
    expect(fs.readFileSync(second, 'utf8')).toBe('an earlier export');
    expect(writeFileBesideBusy(path.join(root, 'Other.csv'), 'rows', { platform: 'win32', fsImpl: lockedFs([path.join(root, 'Other.csv'), path.join(root, 'Other (2).csv')]) })).toBe(path.join(root, 'Other (3).csv'));
  });

  it('writes over the same file when it is free, and on the Mac throws as before', () => {
    const root = temp(); const target = path.join(root, 'Posts.csv'); fs.writeFileSync(target, 'old');
    expect(writeFileBesideBusy(target, 'new', { platform: 'win32' })).toBe(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(() => writeFileBesideBusy(target, 'newer', { platform: 'darwin', fsImpl: lockedFs([target]) })).toThrow('EBUSY');
    expect(fs.readdirSync(root)).toEqual(['Posts.csv']);
  });

  it('names the busy codes', () => {
    expect(['EBUSY', 'EPERM', 'EACCES'].map((code) => isBusyError({ code }))).toEqual([true, true, true]);
    expect(isBusyError({ code: 'ENOENT' })).toBe(false); expect(isBusyError(null)).toBe(false);
  });
});
