import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import voice from '../src/shared/share-of-voice.js';
import workspace from '../src/main/content-workspace.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const track = { enabled: true, source: 'program', terms: ['AI search'], brands: [{ name: 'Semrush', aliases: ['Semrush One'] }, { name: 'Moz' }] };
const post = (externalId, text, platform = 'x', publishedAt = '2026-11-25T00:00:00Z') => ({ externalId, text, platform, publishedAt, author: 'Reader', url: `https://example.com/${externalId}` });

describe('program share of voice', () => {
  it('deduplicates posts and counts one mention per brand while retaining unbranded topic posts', () => {
    const together = post('a', 'AI SEARCH with Semrush One and Moz. Semrush again.');
    const rows = [together, together, post('b', 'AI search with Mozilla'), post('c', 'AI search with Moz', 'linkedin'), post('d', 'Semrush alone'), post('e', 'AI search with Semrush', 'reddit', '2026-11-24T23:59:59Z')].map(voice.normalizePost);
    const config = voice.validateTracking(track);
    const summary = voice.trackingSummary(config, rows, { start: '2026-11-25', end: '2026-11-25' });
    expect(summary.postsCount).toBe(3);
    expect(summary.brandCounts).toEqual([1, 2]);
    expect(summary.platformCounts).toEqual({ x: 2, linkedin: 1, reddit: 0 });
    expect(summary.series).toEqual([{ date: '2026-11-25', posts: 3, brands: [1, 2] }]);
    const filtered = voice.trackingSummary(config, rows, { platform: 'x', brand: 1 });
    expect(filtered.postsCount).toBe(2);
    expect(filtered.posts.map(({ id }) => id)).toEqual(['x:a']);
    expect(() => voice.trackingSummary(config, rows, { start: '2026-02-31' })).toThrow('valid UTC');
  });

  it('validates imported platforms, date and post type and ignores malformed or repeated rows', () => {
    const csv = [
      'Post ID,Platform,Published At,Text,URL,Type',
      '1,Twitter,2026-11-25,"AI search, Semrush",https://x.com/example/status/1,post',
      '1,X,2026-11-25,AI search Semrush,https://x.com/example/status/1,post',
      '2,Reddit,2026-11-25,AI search discussion,javascript:alert(1),post',
      '3,Reddit,2026-11-25,AI search reply,,comment',
      '4,Reddit,,AI search,,post',
    ].join('\n');
    const result = voice.csvPosts(csv);
    expect(result.posts.map((row) => [row.id, row.url])).toEqual([['x:1', 'https://x.com/example/status/1'], ['reddit:2', '']]);
    expect(result.duplicates).toBe(1);
    expect(result.skipped).toBe(2);
    expect(voice.normalizePost(post('invalid', 'AI search', 'x', '2026-02-31T12:00:00Z'))).toBeNull();
    expect(voice.normalizePost(post('utc', 'AI search', 'x', '2026-11-25 12:15:00')).publishedAt).toBe('2026-11-25T12:15:00.000Z');
    expect(() => voice.validateTracking({ ...track, brands: [{ name: 'Semrush' }, { name: 'Other', aliases: ['SEMRUSH'] }] })).toThrow('only one tracked brand');
  });

  it('counts uncapped stored collection rows only for the selected program', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-tests-')); roots.push(root);
    const base = { root, runAI: async () => { throw new Error('No AI is needed for tracking.'); }, defaultWorkspaceId: 'semrush' };
    const service = workspace.createContentWorkspace(base);
    service.saveResearchProgram({ id: 'ai-search', name: 'AI Search', workspaceId: 'semrush' });
    service.saveShareOfVoice({ programId: 'ai-search', config: track });
    const filename = path.join(root, 'state.json');
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    saved.researchRuns = [
      { id: 'main-run', programId: 'ai-search', workspaceId: 'semrush', counts: { retained: 1 }, window: { startDate: '2026-11-24', endDate: '2026-11-25' } },
      { id: 'later-run', programId: 'ai-search', workspaceId: 'semrush', window: { startDate: '2026-11-25', endDate: '2026-11-26' } },
      { id: 'manual-run', programId: 'ai-search', workspaceId: 'semrush' },
      { id: 'old-run', programId: 'ai-search', workspaceId: 'semrush', stage: 'collecting', status: 'failed', updatedAt: '2026-11-10T08:00:00Z', window: { startDate: '2026-11-01', endDate: '' } },
      { id: 'quick', programId: 'ai-search', workspaceId: 'semrush', origin: 'quick-scan' },
      { id: 'other-run', programId: 'other', workspaceId: 'semrush' },
    ];
    fs.writeFileSync(filename, JSON.stringify(saved));
    const manualRun = path.join(root, 'runs', 'manual-run');
    fs.mkdirSync(manualRun, { recursive: true });
    fs.writeFileSync(path.join(manualRun, 'input.json'), JSON.stringify({ datasetIds: ['attached', 'data-other-run', 'wrong-workspace', 'missing-index-entry'] }));
    const datasets = ['main-run', 'later-run', 'old-run', 'quick', 'other-run'].map((run) => ({ id: 'data-' + run, researchRunId: run, workspaceId: 'semrush', platform: run === 'old-run' ? 'linkedin' : 'x' }));
    datasets.push({ id: 'wrong-workspace', researchRunId: 'main-run', workspaceId: 'general', platform: 'x' });
    datasets.push({ id: 'attached', workspaceId: 'semrush', platform: 'reddit' });
    datasets.find((row) => row.id === 'data-old-run').createdAt = '2026-11-10T07:00:00Z';
    const duplicate = post('once', 'AI search in Semrush');
    const rows = {
      'data-main-run': [duplicate, post('two', 'AI search'), post('outside', 'AI search in Moz', 'x', '2026-11-30')],
      'data-later-run': [duplicate, post('three', 'AI search in Moz')],
      'data-old-run': [post('old-post', 'AI search in Moz', 'linkedin', '2026-11-05')],
      'data-other-run': [post('different-program', 'AI search in Moz')],
      attached: [post('imported-in-run', 'AI search', 'reddit')],
    };
    const opened = [];
    const reopened = workspace.createContentWorkspace({ ...base, getDatasets: () => datasets, readDataset: (id) => { opened.push(id); return { items: rows[id] || [] }; } });
    expect(() => reopened.startResearchRun({ programId: 'ai-search', datasetIds: ['data-other-run'] })).toThrow('from this program');
    expect(reopened.publicState().availableDatasets.find((row) => row.id === 'data-other-run')).toMatchObject({ programId: 'other' });
    const result = await reopened.readShareOfVoice({ programId: 'ai-search' });
    expect(opened).toEqual(['data-main-run', 'data-later-run', 'data-old-run', 'attached']);
    expect(result.postsCount).toBe(4);
    expect(result.brandCounts).toEqual([1, 1]);
    expect(result.lastDate).toBe('2026-11-25');
    expect(result.coverage).toMatchObject({ platforms: ['x', 'reddit'], failed: 0, datasets: 3 });
    expect((await reopened.readShareOfVoice({ programId: 'ai-search', platform: 'reddit' })).postsCount).toBe(1);
    expect(opened).toHaveLength(4);
  });

  it('persists imported history and settings through ordinary saves and scopes reads to the assigned program and workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-tests-')); roots.push(root);
    const options = { root, runAI: async () => { throw new Error('No AI is needed for tracking.'); }, defaultWorkspaceId: 'semrush', clock: () => new Date('2026-11-25T12:00:00Z') };
    let scope = null;
    let caps = ['managePrograms'];
    const create = () => workspace.createContentWorkspace({ ...options, getCallerPrograms: () => scope, getCallerCapabilities: () => caps });
    let service = create();
    service.saveResearchProgram({ id: 'ai-search', name: 'AI Search', workspaceId: 'semrush' });
    const config = service.saveShareOfVoice({ programId: 'ai-search', config: { ...track, source: 'import' } });
    const csv = 'post_id,platform,published_at,text\n1,x,2026-11-25,Semrush on AI search\n2,reddit,2026-11-25,Moz on AI search\n3,linkedin,2026-11-25,AI search discussion';
    expect(service.importShareOfVoice({ programId: 'ai-search', csv }).added).toBe(3);
    expect(service.importShareOfVoice({ programId: 'ai-search', csv }).added).toBe(0);
    service.saveResearchProgram({ id: 'ai-search', name: 'AI Search market', workspaceId: 'semrush' });
    service.saveResearchProgram({ id: 'other', name: 'Other program', workspaceId: 'semrush' });
    service.importSetup({ bundle: service.exportSetup() });
    service = create();
    expect((await service.readShareOfVoice({ programId: 'ai-search' })).settings.revision).toBe(config.revision);
    scope = new Set(['ai-search']);
    expect(() => service.saveResearchProgram({ id: 'other', name: 'Attempted change', workspaceId: 'semrush' })).toThrow('unavailable');
    expect(service.saveResearchProgram({ id: 'ai-search', name: 'AI Search', workspaceId: 'semrush' }).name).toBe('AI Search');
    expect(() => service.saveShareOfVoice({ programId: 'ai-search', config: track, revision: 'old-revision' })).toThrow('Reopen');
    scope = new Set(['ai-search']); caps = [];
    const assigned = await service.readShareOfVoice({ programId: 'ai-search' });
    expect(assigned.postsCount).toBe(3);
    expect(assigned.brandCounts).toEqual([1, 1]);
    expect(assigned.settings.brands[0]).toEqual({ name: 'Semrush' });
    scope.clear();
    await expect(service.readShareOfVoice({ programId: 'ai-search' })).rejects.toThrow('unavailable');
    scope = null;
    await expect(service.withWorkspace('general', () => service.readShareOfVoice({ programId: 'ai-search' }))).rejects.toThrow('selected workspace');
  });
});
