import { describe, expect, it } from 'vitest';
import content from '../src/shared/content-studio.js';
import channelView from '../src/main/channel-view.js';
import { buildLibraryTree, channelOf, dayLabel, filterLibrary, folderSummary, groupReports, pathTo, runSummary } from '../src/shared/library-tree.js';

// Records shaped as content-workspace.js writes them: research runs list their report runs in reportRunIds, each report
// run writes a Trends report and an Editorial toolkit, a kit run remembers the report it used (kit.reportAssetId), and a
// Create content run remembers its source (sourceAssetId).
const now = Date.parse('2026-10-17T12:00:00Z');
const AI = 'AI citation tracking'; const PRICE = 'Pricing page confusion';
const theme = (id, name, priorityTier, evidenceCount = 10) => ({ id, name, evidenceCount, scoring: { priorityTier } });
const researchRuns = [
  { id: 'r1', type: 'research', programId: 'p1', title: 'Weekly pulse', status: 'succeeded', createdAt: '2026-10-07T15:00:00Z', discoveredThemes: [theme('t-ai', AI, 'STRONG')], themes: [theme('t-ai', AI, 'STRONG')], reportRunIds: [{ themeId: 't-ai', runId: 'c-r1-ai' }] },
  { id: 'r2', type: 'research', programId: 'p1', title: 'Weekly pulse', status: 'succeeded', createdAt: '2026-10-14T15:00:00Z', discoveredThemes: [theme('t-ai', AI, 'STRONG'), theme('t-price', PRICE, 'FAST-TRACK')], themes: [theme('t-ai', AI, 'STRONG'), theme('t-price', PRICE, 'FAST-TRACK')], reportRunIds: [{ themeId: 't-ai', runId: 'c-r2-ai' }, { themeId: 't-price', runId: 'c-r2-price' }] },
  { id: 'r3', type: 'research', programId: 'p1', title: 'Weekly pulse', status: 'awaiting-review', createdAt: '2026-10-16T15:00:00Z', discoveredThemes: [theme('t-new', 'New idea', 'MONITOR')], themes: [] },
  { id: 'q1', type: 'research', programId: 'p1', origin: 'quick-scan', quickScan: { topic: 'SEO', lookbackHours: 6 }, title: 'Quick scan · SEO', status: 'succeeded', createdAt: '2026-10-15T10:00:00Z', discoveredThemes: [theme('t-q', 'Quick theme', 'LOW')], themes: [] },
  { id: 'q2', type: 'research', programId: 'p1', origin: 'quick-scan', quickScan: { topic: 'AI search', lookbackHours: 12 }, title: 'Quick scan · AI search', status: 'succeeded', createdAt: '2026-10-15T12:00:00Z', themes: [] },
];
const reportRun = (id, researchRunId, themeId, title, createdAt) => ({ id, type: 'content', title, researchRunId, themeId, status: 'succeeded', createdAt, jobs: [{ id: 'evidence-report', status: 'succeeded' }, { id: 'editorial-toolkit', status: 'succeeded' }] });
const kitJobs = (status = 'succeeded') => [
  { id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', folder: 'Semrush Blog', status },
  { id: 'social', label: 'Social Team — LinkedIn + X + FB Captions', kind: 'text', folder: 'Semrush Social Team', status },
  { id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', folder: 'Semrush Social Team', status },
  { id: 'sel-image', label: 'Search Engine Land — Editorial Hero', kind: 'image', folder: 'Search Engine Land / MarTech', status },
];
const kitRun = (id, reportAssetId, createdAt, extra = {}) => ({ id, type: 'content', title: AI, sourceAssetId: reportAssetId, status: 'succeeded', createdAt, kit: { version: 1, sourceKey: 'theme:t-ai', sourceKind: 'trend', sourceTitle: AI, folderName: `Golden Thread — ${AI} (${createdAt.slice(0, 10)})`, reportAssetId, themeId: 't-ai' }, jobs: kitJobs(), ...extra });
const contentRuns = [
  reportRun('c-r1-ai', 'r1', 't-ai', AI, '2026-10-07T18:00:00Z'),
  reportRun('c-r2-ai', 'r2', 't-ai', AI, '2026-10-14T18:00:00Z'),
  reportRun('c-r2-price', 'r2', 't-price', PRICE, '2026-10-14T18:05:00Z'),
  reportRun('c-old', 'r-deleted', 't-old', 'An older trend', '2026-08-01T18:00:00Z'),
  kitRun('k1', 'a-r1-ai-report', '2026-10-08T09:00:00Z'),
  kitRun('k2', 'a-r2-ai-report', '2026-10-15T09:00:00Z'),
  { id: 'k3', type: 'content', title: 'Partner launch notes', status: 'running', createdAt: '2026-10-16T09:00:00Z', kit: { version: 1, sourceKey: 'gdoc:abc123', sourceKind: 'google-doc', sourceTitle: 'Partner launch notes', folderName: 'Golden Thread — Partner launch notes (2026-10-16)', sourceUrl: 'https://docs.google.com/document/d/abc123/edit' }, jobs: kitJobs('queued') },
  { id: 'd1', type: 'content', title: AI, sourceAssetId: 'a-r2-ai-report', status: 'succeeded', createdAt: '2026-10-15T10:00:00Z', jobs: [{ id: 'bloglong', status: 'succeeded' }] },
  { id: 'd2', type: 'content', title: 'Social follow-up', sourceAssetId: 'a-d1-blog', status: 'succeeded', createdAt: '2026-10-15T11:00:00Z', jobs: [{ id: 'social', status: 'succeeded' }] },
  { id: 'd3', type: 'content', title: 'Campaign from a brief', status: 'succeeded', createdAt: '2026-10-12T10:00:00Z', jobs: [{ id: 'newsletter', status: 'succeeded' }] },
];
const text = (id, runId, deliverableId, title, createdAt, extra = {}) => ({ id, workspaceId: 'ws', runId, deliverableId, title, kind: 'text', createdAt, reviewStatus: 'draft', ...extra });
const picture = (id, runId, deliverableId, variantIndex, createdAt) => ({ id, workspaceId: 'ws', runId, deliverableId, variantIndex, title: `Picture ${id}`, kind: 'image', format: 'png', createdAt, reviewStatus: 'draft' });
const assets = [
  text('a-r1-ai-report', 'c-r1-ai', 'evidence-report', `${AI} — Comprehensive Trends Report`, '2026-10-07T18:10:00Z'),
  text('a-r1-ai-toolkit', 'c-r1-ai', 'editorial-toolkit', `TREND: ${AI}`, '2026-10-07T18:12:00Z'),
  text('a-r2-ai-report', 'c-r2-ai', 'evidence-report', `${AI} — Comprehensive Trends Report`, '2026-10-14T18:10:00Z', { edited: { at: '2026-10-16T08:00:00Z', by: { id: 'riley', name: 'Riley' } } }),
  text('a-r2-ai-toolkit', 'c-r2-ai', 'editorial-toolkit', `TREND: ${AI}`, '2026-10-14T18:12:00Z'),
  text('a-r2-price-report', 'c-r2-price', 'evidence-report', `${PRICE} — Comprehensive Trends Report`, '2026-10-14T18:20:00Z'),
  text('a-old-report', 'c-old', 'evidence-report', 'An older trend — Comprehensive Trends Report', '2026-08-01T18:10:00Z'),
  text('a-k1-blog', 'k1', 'blogshort', 'Citations are the new rankings', '2026-10-08T09:10:00Z'),
  text('a-k2-blog', 'k2', 'blogshort', 'Citations, a week later', '2026-10-15T09:10:00Z'),
  text('a-k2-social', 'k2', 'social', 'Social captions for citations', '2026-10-15T09:11:00Z'),
  picture('a-k2-hero-1', 'k2', 'brand-image', 1, '2026-10-15T09:13:00Z'),
  picture('a-k2-hero-0', 'k2', 'brand-image', 0, '2026-10-15T09:12:00Z'),
  picture('a-k2-sel', 'k2', 'sel-image', 0, '2026-10-15T09:14:00Z'),
  text('a-d1-blog', 'd1', 'bloglong', 'Long read on citations', '2026-10-15T10:10:00Z', { channel: 'Blog' }),
  text('a-d2-social', 'd2', 'social', 'Thread from the long read', '2026-10-15T11:10:00Z', { channel: 'Social' }),
  text('a-d3-news', 'd3', 'newsletter', 'Newsletter from a brief', '2026-10-12T10:10:00Z', { channel: 'Email' }),
  text('a-q2-note', 'q2', 'blogshort', 'Quick scan write-up', '2026-10-15T13:00:00Z'),
  text('a-loose', 'gone', 'pr', 'PR brief from a removed run', '2026-10-01T10:00:00Z'),
];
const programs = [{ id: 'p1', workspaceId: 'ws', name: 'Weekly pulse' }];
const helpImages = [{ id: 'help-image-1', title: 'Hero idea', prompt: 'A calm hero picture', size: '1536x1024', createdAt: '2026-10-16T12:00:00Z' }];
const adoptionsByTheme = { 't-ai': { blog: { status: 'using', channelName: 'Semrush Blog' }, pr: { status: 'skipped' } } };
const tree = (editionId = 'semrush', extra = {}) => buildLibraryTree({ researchRuns, contentRuns, assets, programs, editionId, helpImages, adoptionsByTheme, now, ...extra });
const titles = (library, ids) => ids.map((id) => library.nodes[id].title);

describe('library tree: research runs and trends', () => {
  it('files a trend reported by two research runs under each run, and each set under the run whose report it used', () => {
    const library = tree();
    expect(library.roots).toEqual(['research:q2', 'research:r2', 'research:r1', 'earlier', 'other-sources', 'loose-drafts', 'other-files', 'pictures']);
    expect(library.nodes['research:r2'].title).toBe(`${dayLabel('2026-10-14T15:00:00Z', now)} · Weekly pulse`);
    // Fast-track first, then the research run's own order.
    expect(titles(library, library.nodes['research:r2'].children)).toEqual([PRICE, AI]);
    expect(titles(library, library.nodes['research:r1'].children)).toEqual([AI]);
    // kit.reportAssetId decides the folder, never the shared 'theme:t-ai' source key.
    expect(library.nodes['kits:trend:r1:t-ai'].children).toEqual(['kit:k1']);
    expect(library.nodes['kits:trend:r2:t-ai'].children).toEqual(['kit:k2']);
    expect(library.bySourceKey['theme:t-ai']).toEqual(['trend:r2:t-ai', 'trend:r1:t-ai']);
    expect(library.nodes['trend:r2:t-ai'].meta).toMatchObject({ reportAssetId: 'a-r2-ai-report', toolkitAssetId: 'a-r2-ai-toolkit', usedBy: [{ channelId: 'blog', name: 'Semrush Blog' }] });
    expect(library.nodes['trend:r2:t-ai'].itemKeys).toEqual(['studio:a-r2-ai-report', 'studio:a-r2-ai-toolkit']);
    expect(library.nodes['trend:r2:t-ai'].children).toEqual(['kits:trend:r2:t-ai', 'drafts:trend:r2:t-ai', 'pictures:trend:r2:t-ai']);
    expect(folderSummary(library.nodes['research:r2'], now)).toBe(`2 trends · 10 files · 3 pictures · ${dayLabel('2026-10-14T15:00:00Z', now)}`);
    expect(folderSummary(library.nodes['trend:r2:t-ai'], now)).toBe('Report + toolkit · 1 asset set · 9 files');
  });

  it('follows drafts to their trend through up to three sources, and keeps the rest apart', () => {
    const library = tree();
    expect(library.nodes['drafts:trend:r2:t-ai'].itemKeys).toEqual(['studio:a-d2-social', 'studio:a-d1-blog']);
    expect(library.nodes['loose-drafts'].children).toEqual(['draft-run:d3']);
    expect(library.nodes['draft-run:d3'].itemKeys).toEqual(['studio:a-d3-news']);
    // A chain longer than three hops stops looking.
    const chain = [1, 2, 3, 4].map((n) => ({ id: `chain-${n}`, type: 'content', title: `Step ${n}`, sourceAssetId: n === 1 ? 'a-r2-ai-report' : `a-chain-${n - 1}`, status: 'succeeded', createdAt: `2026-10-16T0${n}:00:00Z` }));
    const deep = buildLibraryTree({ researchRuns, contentRuns: [...contentRuns, ...chain], assets: [...assets, ...chain.map((run, index) => text(`a-chain-${index + 1}`, run.id, 'social', run.title, run.createdAt))], programs, editionId: 'semrush', now });
    expect(deep.itemsByKey['studio:a-chain-3'].location).toBe('drafts:trend:r2:t-ai');
    expect(deep.itemsByKey['studio:a-chain-4'].location).toBe('draft-run:chain-4');
  });

  it('places orphans: other sources, earlier research, loose files, quick scans and runs still waiting', () => {
    const library = tree();
    expect(library.nodes['other-sources'].children).toEqual(['source:gdoc:abc123']);
    expect(library.nodes['source:gdoc:abc123']).toMatchObject({ title: 'Partner launch notes', live: true, children: ['kit:k3'], meta: { sourceKind: 'google-doc' } });
    expect(library.nodes['other-sources'].live).toBe(true);
    expect(library.bySourceKey['gdoc:abc123']).toEqual(['source:gdoc:abc123']);
    expect(titles(library, library.nodes.earlier.children)).toEqual(['An older trend']);
    expect(library.nodes['other-files'].itemKeys).toEqual(['studio:a-loose']);
    // A quick scan is a folder only once something was made from it.
    expect(library.nodes['research:q2']).toMatchObject({ title: 'Quick scan · AI search', itemKeys: ['studio:a-q2-note'] });
    expect(library.nodes['research:q1']).toBeUndefined();
    expect(library.pending).toEqual([{ runId: 'r3', title: 'Weekly pulse', status: 'awaiting-review', createdAt: '2026-10-16T15:00:00Z' }]);
    // Every picture, plus Ask AI's, which are shared across workspaces.
    expect(library.nodes.pictures.itemKeys).toEqual(['studio:a-k2-sel', 'studio:a-k2-hero-1', 'studio:a-k2-hero-0']);
    expect(library.nodes['pictures:ask'].itemKeys).toEqual(['help:help-image-1']);
    expect(library.itemsByKey['studio:a-k2-hero-0'].nodeIds).toEqual(['channel:k2:social', 'pictures', 'pictures:trend:r2:t-ai']);
    expect(library.byAssetId['a-k2-hero-0']).toEqual(['channel:k2:social', 'pictures', 'pictures:trend:r2:t-ai']);
  });

  it('adds the earlier content board only when there is something from it', () => {
    expect(tree().nodes.legacy).toBeUndefined();
    const library = tree('semrush', { legacyAssets: [{ id: 'old-1', title: 'Old board draft', channel: 'Blog', status: 'draft', createdAt: '2026-05-01T10:00:00Z' }] });
    expect(library.roots.at(-1)).toBe('legacy');
    expect(library.nodes.legacy.itemKeys).toEqual(['legacy:old-1']);
  });
});

describe('library tree: channel teams', () => {
  it('groups a set by deliverable id, named for the edition', () => {
    const semrush = tree('semrush');
    expect(semrush.nodes['kit:k2'].children).toEqual(['channel:k2:blog', 'channel:k2:social', 'channel:k2:searchengineland']);
    expect(titles(semrush, semrush.nodes['kit:k2'].children)).toEqual(['Semrush Blog', 'Semrush Social Team', 'Search Engine Land / MarTech']);
    expect(semrush.nodes['channel:k2:social'].itemKeys).toEqual(['studio:a-k2-social', 'studio:a-k2-hero-0', 'studio:a-k2-hero-1']);
    expect(folderSummary(semrush.nodes['channel:k2:social'])).toBe('2/2 ready');
    // The general edition doesn't offer the SEL pictures, so it files one under Other, as the main process does.
    const general = tree('general');
    expect(titles(general, general.nodes['kit:k2'].children)).toEqual(['Blog', 'Social', 'Other']);
    // Without an edition the names saved on the set are used.
    const unknown = tree('');
    expect(unknown.nodes['kit:k2'].children).toEqual(['channel:k2:blog', 'channel:k2:social', 'channel:k2:searchengineland']);
    expect(titles(unknown, unknown.nodes['kit:k2'].children)).toEqual(['Semrush Blog', 'Semrush Social Team', 'Search Engine Land / MarTech']);
  });

  it('matches the main process channelOf for every deliverable in both editions', () => {
    for (const editionId of ['general', 'semrush']) for (const deliverable of content.CONTENT_DELIVERABLES) expect([deliverable.id, editionId, channelOf(deliverable.id, editionId)]).toEqual([deliverable.id, editionId, channelView.channelOf(deliverable.id, editionId)]);
  });

  it('says what a set is doing in one line', () => {
    expect(runSummary({ status: 'running', jobs: [{ status: 'succeeded' }, { status: 'running' }] })).toBe('Making assets · 1 of 2 ready');
    expect(runSummary({ status: 'partial', jobs: [{ status: 'succeeded' }, { status: 'failed' }] })).toBe('1 of 2 ready · 1 needs another try');
  });
});

describe('library tree: search, paths and report groups', () => {
  it('builds the breadcrumb from the root', () => {
    const library = tree();
    expect(pathTo(library, 'channel:k2:social').map((node) => node.title)).toEqual([library.nodes['research:r2'].title, AI, 'Channel assets', library.nodes['kit:k2'].title, 'Semrush Social Team']);
    expect(pathTo(library, 'nowhere')).toEqual([]);
  });

  it('filters by words, type, channel and date, flat, with each result’s path', () => {
    const library = tree();
    // A social draft belongs to the Social Team too.
    const social = filterLibrary(library, { query: 'social team' });
    expect(social.active).toBe(true);
    expect(social.items.map((item) => item.id)).toEqual(['a-d2-social', 'a-k2-hero-1', 'a-k2-hero-0', 'a-k2-social']);
    expect(social.items[3].path.map((node) => node.id)).toEqual(['research:r2', 'trend:r2:t-ai', 'kits:trend:r2:t-ai', 'kit:k2', 'channel:k2:social']);
    expect(social.items[0].path.map((node) => node.id)).toEqual(['research:r2', 'trend:r2:t-ai', 'drafts:trend:r2:t-ai']);
    expect(social.counts['research:r2']).toBe(4);
    expect(social.expand.has('kit:k2')).toBe(true);
    expect(filterLibrary(library, { types: ['toolkit'] }).items.map((item) => item.id)).toEqual(['a-r2-ai-toolkit', 'a-r1-ai-toolkit']);
    expect(filterLibrary(library, { types: ['picture'] }).items.map((item) => item.id)).toEqual(['help-image-1', 'a-k2-sel', 'a-k2-hero-1', 'a-k2-hero-0']);
    expect(filterLibrary(library, { channels: ['blog'] }).items.map((item) => item.id)).toEqual(['a-q2-note', 'a-d1-blog', 'a-k2-blog', 'a-k1-blog']);
    expect(filterLibrary(library, { channels: ['research'], from: '2026-10-10', to: '2026-10-14' }).items.map((item) => item.id)).toEqual(['a-r2-price-report', 'a-r2-ai-report']);
    // Trend names and research runs are searchable too, not just file titles.
    expect(filterLibrary(library, { query: 'pricing' }).items.map((item) => item.id)).toEqual(['a-r2-price-report']);
    expect(filterLibrary(library, {}).active).toBe(false);
  });

  it('gives Simple Reports one entry per trend, grouped by research run', () => {
    const entries = groupReports(tree());
    expect(entries.map((entry) => [entry.groupId, entry.title])).toEqual([['research:r2', PRICE], ['research:r2', AI], ['research:r1', AI], ['earlier', 'An older trend']]);
    expect(entries[1]).toMatchObject({ nodeId: 'trend:r2:t-ai', reportId: 'a-r2-ai-report', toolkitId: 'a-r2-ai-toolkit', primaryId: 'a-r2-ai-report', edited: { at: '2026-10-16T08:00:00Z' }, channelAssets: { nodeId: 'kits:trend:r2:t-ai', kits: 1, files: 5 } });
    expect(entries[0]).toMatchObject({ reportId: 'a-r2-price-report', toolkitId: '', channelAssets: { nodeId: '', files: 0 } });
    expect(entries[3].groupTitle).toBe('Earlier research');
  });
});
