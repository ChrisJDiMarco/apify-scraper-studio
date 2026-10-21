import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import supervisor from './backup-supervisor.cjs';

const { due, encrypt, decrypt, expired, takeBackup } = supervisor;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

test('Pacific schedule follows DST and runs once per local day', () => {
  assert.equal(due(new Date('2026-10-22T08:59:00Z'), '2026-10-21'), false);
  assert.equal(due(new Date('2026-10-22T09:00:00Z'), '2026-10-21'), true);
  assert.equal(due(new Date('2026-10-22T10:00:00Z'), '2026-10-22'), false);
  // Spring skips 2 a.m.; run at the first time after the missing hour.
  assert.equal(due(new Date('2027-03-14T09:59:00Z'), '2027-03-13'), false);
  assert.equal(due(new Date('2027-03-14T10:00:00Z'), '2027-03-13'), true);
  // Fall uses standard time for 2 a.m.
  assert.equal(due(new Date('2026-11-01T09:59:00Z'), '2026-10-31'), false);
  assert.equal(due(new Date('2026-11-01T10:00:00Z'), '2026-10-31'), true);
});

test('encrypted archive decrypts and rejects tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-crypto-'));
  try {
    const key = crypto.randomBytes(32).toString('hex'); const source = path.join(dir, 'source'); const encoded = path.join(dir, 'encoded'); const plain = path.join(dir, 'plain');
    fs.writeFileSync(source, 'private research');
    await encrypt(source, encoded, key); await decrypt(encoded, plain, key);
    assert.equal(fs.readFileSync(plain, 'utf8'), 'private research');
    const content = fs.readFileSync(encoded); content[content.length - 1] ^= 1; fs.writeFileSync(encoded, content);
    await assert.rejects(decrypt(encoded, plain, key));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('retention keeps 14 daily and 3 deployment archives, ignores unrelated objects', () => {
  const key = (kind, n) => `golden-thread/v1/${kind}/2026-10-${String(n).padStart(2, '0')}/scraper-studio-backup-2026-10-${String(n).padStart(2, '0')}T01-00-00-000Z.tar.gz.enc`;
  const objects = Array.from({ length: 16 }, (_, n) => ({ key: key('daily', n + 1) })).concat(Array.from({ length: 4 }, (_, n) => ({ key: key('deployment', n + 1) })), [{ key: 'other/document.txt' }]);
  assert.deepEqual(expired(objects).map((o) => o.key).sort(), [key('daily', 1), key('daily', 2), key('deployment', 1)].sort());
});

test('upload is downloaded, decrypted and restored; corrupted uploads never prune', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-backup-'));
  const dataDir = path.join(dir, 'data'); fs.mkdirSync(dataDir); fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"example":true}');
  const config = { dataDir, encryptionKey: crypto.randomBytes(32).toString('hex'), maxBytes: 10000000 };
  let content; let storedKey; let corrupt = false; let removals = 0;
  const store = {
    async list() { return content ? [{ key: storedKey, size: content.length }] : []; },
    async put(key, file) { storedKey = key; content = fs.readFileSync(file); },
    async get(key, file) { const copy = Buffer.from(content); if (corrupt) copy[copy.length - 1] ^= 1; fs.writeFileSync(file, copy); },
    async remove() { removals++; },
  };
  const options = { storage: store, runtime: path.join(dir, 'runtime'), appRoot: path.resolve(moduleDir, '../..') };
  try {
    const result = await takeBackup(config, 'daily', options);
    assert.equal(result.restored, true); assert.equal(result.files, 1);
    assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), '{"example":true}');
    corrupt = true;
    await assert.rejects(takeBackup(config, 'daily', options), /checksum/);
    assert.equal(removals, 0);
    assert.equal(fs.existsSync(path.join(options.runtime, 'backup.lock')), false);
    config.maxBytes = 1;
    await assert.rejects(takeBackup(config, 'daily', options), /budget guard/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
