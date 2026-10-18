import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import storeModule from '../src/main/monday-store.js';

// content-studio/monday.json and monday-log.jsonl (src/main/monday-store.js).
const { createMondayStore, hashSecret } = storeModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const tempRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monday-store-')); roots.push(root); return root; };

describe('the Monday.com store', () => {
  it('moves the old config.json board into a manual link, keeping every item ID', () => {
    const root = tempRoot(); const store = createMondayStore({ root });
    const moved = store.migrateLegacy({ boardId: '123', boardName: 'Trends', statusColumnId: 'status', notesColumnId: 'notes', itemIds: { 'r1:t1': '9001', 'r1:t2': '9002' }, lastSyncedAt: '2026-10-01T00:00:00Z' }, 'semrush');
    expect(moved).toBe(true);
    const link = store.link('semrush');
    expect(link).toMatchObject({ active: true, boardId: '123', columns: { stage: 'status', notes: 'notes' }, push: { mode: 'manual' }, pull: { mode: 'manual' } });
    expect(store.items('semrush')['r1:t1']).toMatchObject({ itemId: '9001', state: 'synced', pushed: {} });
    expect(store.readLog({ ws: 'semrush' }).rows[0].text).toMatch(/Turn on automatic sync in Settings/);
    expect(store.migrateLegacy({ boardId: '456' }, 'semrush')).toBe(false); // once only
    expect(JSON.parse(fs.readFileSync(path.join(root, 'monday.json'), 'utf8')).links.semrush.boardId).toBe('123');
  });

  it('refuses a setup save made over someone else’s newer one', () => {
    const store = createMondayStore({ root: tempRoot() });
    const first = store.saveLink('general', { boardId: '1' });
    store.saveLink('general', { boardName: 'Mine' }, { rev: first.rev });
    expect(() => store.saveLink('general', { boardName: 'Theirs' }, { rev: first.rev })).toThrow(expect.objectContaining({ status: 409, code: 'mondaySetupChanged' }));
    // The engine's bookkeeping never moves rev.
    const before = store.link('general').rev; store.updateLink('general', { lastPushAt: 'now' });
    expect(store.link('general').rev).toBe(before);
  });

  it('writes atomically and keeps a damaged file aside', () => {
    const root = tempRoot(); const store = createMondayStore({ root });
    store.patchItems('general', { a: { itemId: '1' } });
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    fs.writeFileSync(path.join(root, 'monday.json'), '{ broken');
    const warnings = []; const again = createMondayStore({ root, onDamaged: (message) => warnings.push(message) });
    expect(again.items('general')).toEqual({});
    expect(warnings[0]).toMatch(/damaged/);
    expect(fs.readdirSync(root).some((name) => name.startsWith('monday.json.bad-'))).toBe(true);
  });

  it('trims the log to 2,000 rows and filters it', () => {
    const store = createMondayStore({ root: tempRoot() });
    const rows = Array.from({ length: 2300 }, (_, i) => ({ ws: 'general', dir: i % 2 ? 'in' : 'out', kind: i % 10 ? 'updated' : 'error', ok: Boolean(i % 10), key: i === 2299 ? 'r1:t1' : `k${i}`, text: `row ${i}`, at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));
    store.appendLog(rows);
    const all = store.readLog({ ws: 'general', limit: 200 });
    expect(all.rows).toHaveLength(200); expect(all.more).toBe(true); expect(all.rows[0].text).toBe('row 2299');
    expect(fs.readFileSync(store.logFile, 'utf8').trim().split('\n')).toHaveLength(2000);
    expect(store.readLog({ ws: 'general', problemsOnly: true, limit: 200 }).rows.every((row) => row.ok === false)).toBe(true);
    expect(store.readLog({ ws: 'general', key: 'r1:t1' }).rows.map((row) => row.text)).toEqual(['row 2299']);
    expect(store.readLog({ ws: 'general', direction: 'in', limit: 5 }).rows.every((row) => row.dir === 'in')).toBe(true);
    expect(store.readLog({ ws: 'general', before: all.rows[0].at, limit: 1 }).rows[0].text).toBe('row 2298');
  });

  it('matches webhook secrets by hash only', () => {
    const root = tempRoot(); const store = createMondayStore({ root });
    const secret = 'a'.repeat(64);
    store.saveLink('general', { boardId: '1', hookSecretHash: hashSecret(secret) });
    expect(store.hookMatch(secret)).toBe('general');
    expect(store.hookMatch('b'.repeat(64))).toBe(null);
    expect(store.hookMatch('not-hex')).toBe(null);
    expect(fs.readFileSync(path.join(root, 'monday.json'), 'utf8')).not.toContain(secret);
  });

  it('counts calls per UTC day', () => {
    let clock = Date.UTC(2026, 9, 17, 23, 59, 0);
    const store = createMondayStore({ root: tempRoot(), now: () => clock });
    store.countCall(); store.countCall(2);
    expect(store.callsToday()).toBe(3);
    clock = Date.UTC(2026, 9, 18, 0, 0, 30);
    expect(store.callsToday()).toBe(0);
    store.countCall();
    expect(store.callsToday()).toBe(1);
  });
});
