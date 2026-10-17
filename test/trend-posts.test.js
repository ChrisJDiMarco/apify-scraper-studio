import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';

const { createContentWorkspace } = workspaceModule;
const AT = '2026-10-01T09:00:00.000Z';
const TREND = 'AI answer engines replace search';
const roots = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const post = (id, extra = {}) => ({ id, platform: 'reddit', author: `u/${id}`, text: `Post ${id} about answer engines.`, url: `https://www.reddit.com/r/seo/comments/${id}/`, publishedAt: '2026-10-09T12:00:00Z', engagement: { value: 1 }, ...extra });
const space = (id, editionId) => ({ id, name: id === 'semrush' ? 'Semrush workspace' : 'Your workspace', editionId, knowledge: {}, products: [], createdAt: AT, updatedAt: AT });
const run = (id, workspaceId, createdAt, themes) => ({ id, workspaceId, type: 'research', title: `Run ${id}`, programId: 'program-a', status: 'succeeded', stage: 'reports', createdAt, updatedAt: createdAt, discoveredThemes: themes, themes, decisions: {}, counts: { retained: 6 } });

// Two runs in the active workspace find the same trend (under two theme ids); the newer one was tagged. A third run in
// the other workspace finds it too and must never show here.
function studio() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trend-posts-')); roots.push(root);
  const write = (runId, name, value) => { const dir = path.join(root, 'runs', runId); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); };
  const long = 'x'.repeat(400);
  write('run-old', 'evidence.json', { items: [post('e1', { engagement: { value: 3 } }), post('e2', { title: 'Answer engines are the new search', text: long, platform: 'x', author: 'sam', authorName: 'Sam', url: 'https://x.com/sam/status/2' }), post('e9')] });
  write('run-new', 'evidence.json', { items: [post('n1', { engagement: { value: 99 } }), post('n2', { engagement: { value: 5 } }), post('n3', { engagement: { value: 50 } }), post('n4', { engagement: { value: 8 }, url: 'javascript:alert(1)' })] });
  write('run-new', 'assignments.json', [{ itemId: 'n2', themeId: 'theme-new', status: 'confirmed' }, { itemId: 'n3', themeId: 'theme-new', status: 'rejected' }, { itemId: 'n4', themeId: 'theme-new', status: 'needs-review' }]);
  write('run-other', 'evidence.json', { items: [post('o1', { engagement: { value: 1000 } })] });
  const state = {
    version: 1, activeWorkspaceId: 'general', workspaces: [space('general', 'general'), space('semrush', 'semrush')], programs: [],
    researchRuns: [
      run('run-old', 'general', AT, [{ id: 'theme-old', name: TREND, evidenceIds: ['e1', 'e2'] }]),
      run('run-new', 'general', '2026-10-10T09:00:00.000Z', [{ id: 'theme-new', name: TREND, evidenceIds: ['n1'] }]),
      run('run-other', 'semrush', '2026-10-12T09:00:00.000Z', [{ id: 'theme-other', name: TREND, evidenceIds: ['o1'] }]),
    ],
    contentRuns: [], themes: [], history: [], detections: [], assets: [], exports: [], datasetOwners: {},
  };
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state));
  const runAI = vi.fn(async () => { throw new Error('No AI in this test.'); });
  return { root, runAI, api: createContentWorkspace({ root, runAI, clock: () => new Date('2026-10-15T09:00:00Z') }) };
}

describe('readTrendPosts', () => {
  it('returns a trend’s tagged posts when its run was tagged, most engaged first, two by default', () => {
    const { api, runAI } = studio();
    // n1 is only discovery evidence and n3 was rejected, so the tagged posts n4 and n2 are the ones shown.
    expect(api.readTrendPosts({ themeId: 'theme-new' })).toEqual([
      { platform: 'reddit', author: 'u/n4', text: 'Post n4 about answer engines.', url: '', publishedAt: '2026-10-09T12:00:00Z', engagement: 8 },
      { platform: 'reddit', author: 'u/n2', text: 'Post n2 about answer engines.', url: 'https://www.reddit.com/r/seo/comments/n2/', publishedAt: '2026-10-09T12:00:00Z', engagement: 5 },
    ]);
    expect(runAI).not.toHaveBeenCalled();
  });

  it('uses the posts discovery cited for a run that wasn’t tagged, and follows a trend across runs by name or id', () => {
    const { api } = studio();
    const old = api.readTrendPosts({ themeId: 'theme-old', limit: 5 });
    expect(old.map((row) => row.author)).toEqual(['u/e1', 'Sam']);
    expect(old[1].text.startsWith('Answer engines are the new search — xxx')).toBe(true);
    expect(old[1].text).toHaveLength(280); expect(old[1].text.endsWith('…')).toBe(true);
    // By name: the newest run first (its tagged posts), then the older run; never the other workspace's run.
    expect(api.readTrendPosts({ name: TREND, limit: 10 }).map((row) => row.author)).toEqual(['u/n4', 'u/n2', 'u/e1', 'Sam']);
    expect(api.readTrendPosts({ trendId: 'theme-old', limit: 10 })).toHaveLength(4);
    expect(api.readTrendPosts({ name: 'Something nobody posted about' })).toEqual([]);
    expect(api.readTrendPosts({})).toEqual([]);
    api.selectContentWorkspace('semrush');
    expect(api.readTrendPosts({ name: TREND }).map((row) => row.author)).toEqual(['u/o1']);
  });

  it('reads a run’s files once until the run changes', () => {
    const { api, root } = studio();
    const reads = vi.spyOn(fs, 'readFileSync');
    const evidenceReads = () => reads.mock.calls.filter(([file]) => String(file).endsWith(path.join('run-new', 'evidence.json'))).length;
    api.readTrendPosts({ themeId: 'theme-new' }); api.readTrendPosts({ themeId: 'theme-new', limit: 1 });
    expect(evidenceReads()).toBe(1);
    // New tags rewrite assignments.json, which changes the run's version.
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(root, 'runs', 'run-new', 'assignments.json'), JSON.stringify([{ itemId: 'n1', themeId: 'theme-new', status: 'confirmed' }]));
    fs.utimesSync(path.join(root, 'runs', 'run-new', 'assignments.json'), later, later);
    expect(api.readTrendPosts({ themeId: 'theme-new', limit: 1 })[0].author).toBe('u/n1');
    expect(evidenceReads()).toBe(2);
  });
});
