import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Source checks behind the Windows save fixes. Antivirus, EDR and sync agents hold a just-closed file, so on Windows a
// plain fs.renameSync over it fails with EPERM/EBUSY; every atomic save must go through src/shared/durable-write.js.
const read = (file) => fs.readFileSync(file, 'utf8');
const sources = ['src/main', 'src/shared'].flatMap((dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.js')).map((name) => path.posix.join(dir, name)));

describe('atomic saves on Windows', () => {
  it('rename through durable-write everywhere except the move-aside of a damaged file and the owner-lock heartbeat', () => {
    const plain = [];
    for (const file of sources) {
      // durable-write is the one place that renames; the owner-lock heartbeat is best-effort and retried every beat.
      if (['src/shared/durable-write.js', 'src/main/studio-owner-lock.js'].includes(file)) continue;
      read(file).split('\n').forEach((line, index) => { if (line.includes('renameSync(') && !/unreadable|damaged|aside/.test(line)) plain.push(`${file}:${index + 1}: ${line.trim()}`); });
    }
    expect(plain).toEqual([]);
  });

  it('covers each of the studio’s save helpers', () => {
    for (const file of ['src/main/content-workspace.js', 'src/main/team-store.js', 'src/main/prompt-store.js', 'src/main/ask-store.js', 'src/main/monday-store.js']) expect(read(file), file).toMatch(/writeFileDurable\(/);
    for (const file of ['src/main/drive-sync.js', 'src/main/report-docs.js', 'src/main/report-notes.js', 'src/main/workflow-store.js', 'src/main/workbooks.js', 'src/main/ai-limits.js']) expect(read(file), file).toMatch(/renameDurable\(/);
    const main = read('src/main/index.js');
    const writeJson = main.slice(main.indexOf('function writeJson('), main.indexOf('\n}\n', main.indexOf('function writeJson(')));
    // index.js passes its own platform and fs down: test harnesses run it with a fake process and fs.
    expect(writeJson).toContain("writeFileDurable(filePath, JSON.stringify(value, null, 2), { platform: process.platform, fsImpl: fs })");
  });

  it('never lets studio-host’s temp-file cleanup hide the error that stopped a save', () => {
    const host = read('src/main/studio-host.js');
    const atomicJson = host.slice(host.indexOf('function atomicJson('), host.indexOf('function loadMetadata('));
    expect(atomicJson).toContain('renameDurable(temporary, target)');
    const cleanup = atomicJson.slice(atomicJson.indexOf('finally {'));
    expect(cleanup).toMatch(/try \{ if \(fs\.existsSync\(temporary\)\) fs\.unlinkSync\(temporary\); \} catch/);
    expect(cleanup).toMatch(/try \{ if \(fd !== undefined\) fs\.closeSync\(fd\); \} catch/);
  });

  it('keeps the error that stopped a content run when removing its half-made folder fails too', () => {
    const lines = read('src/main/content-workspace.js').split('\n').filter((line) => line.includes('catch (error) {') && line.includes('rmSync('));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const handler = line.slice(line.indexOf('catch (error) {'));
      expect(handler.slice(0, handler.indexOf('rmSync(')), line.trim()).toContain('try {');
      expect(handler, line.trim()).toContain('throw error;');
    }
  });
});
