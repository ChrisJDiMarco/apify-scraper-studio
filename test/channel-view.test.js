import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import channelView from '../src/main/channel-view.js';
import { buildTrendBoard } from '../src/shared/trend-board.js';
import research from './helpers/research-ai-fixture.js';
import fixture from './fixtures/roles-state.js';
const { createContentWorkspace } = workspaceModule;
const { kitChannelIds, publicKitRun, readyTrends, buildChannelView } = channelView;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

// The board's ready trends, one per theme: cards whose report run succeeded (stage ready, or production while assets
// are being made from it).
function boardReady(studio) {
  const byTheme = new Map();
  for (const card of buildTrendBoard(studio).cards) if (card.reportAssets) byTheme.set(card.themeId, [...(byTheme.get(card.themeId) || []), card]);
  return byTheme;
}
function expectParity(studio) {
  const board = boardReady(studio); const ready = readyTrends(studio);
  expect(ready.map((trend) => trend.themeId).sort()).toEqual([...board.keys()].sort());
  for (const trend of ready) {
    const card = board.get(trend.themeId).find((entry) => entry.reportRunId === trend.reportRunId);
    expect(card).toBeTruthy();
    expect({ name: trend.name, category: trend.category, evidenceCount: trend.evidenceCount, reportAssets: trend.reportAssets }).toEqual({ name: card.name, category: card.category, evidenceCount: card.evidenceCount, reportAssets: card.reportAssets });
  }
  return ready;
}

describe('ready trends match the Trends board', () => {
  it('on a studio with runs at every stage', () => {
    const ready = expectParity(fixture.contentStudio());
    expect(ready.map((trend) => [trend.themeId, trend.readyAt, trend.reportRunId, trend.primaryReportId, trend.priority, trend.briefEditedAt])).toEqual([
      ['theme-local', fixture.at('10-11', '19:40:00'), 'content-report-local', 'asset-local-toolkit', 'watch', null],
      // Two research runs wrote reports for this theme; the newest supplies readyAt, the files and the edited brief.
      ['theme-aio', fixture.at('10-11', '09:30:00'), 'content-report-aio-2', 'asset-aio-toolkit-2', 'top', fixture.at('10-12', '08:00:00')],
    ]);
  });

  it('on the edge cases: review, cancellation, legacy runs, passed themes and a first report that failed', () => {
    const report = (id, status) => ({ id, type: 'content', status, createdAt: fixture.at('10-02') });
    const file = (id, runId, deliverableId) => ({ id, runId, deliverableId, title: id, kind: 'text', createdAt: fixture.at('10-02') });
    const studio = {
      researchRuns: [
        { id: 'r-review', status: 'awaiting-review', createdAt: fixture.at('10-09'), discoveredThemes: [{ id: 't-review', name: 'Under review' }], themes: [{ id: 't-review', name: 'Under review' }], decisions: { 't-review': 'approved' }, reportRunIds: [{ themeId: 't-review', runId: 'c-review' }] },
        { id: 'r-cancelled', status: 'cancelled', createdAt: fixture.at('10-08'), discoveredThemes: [{ id: 't-cancelled', name: 'Cancelled after reports' }], themes: [{ id: 't-cancelled', name: 'Cancelled after reports' }], reportRunIds: [{ themeId: 't-cancelled', runId: 'c-cancelled' }] },
        { id: 'r-cancelled-early', status: 'cancelled', createdAt: fixture.at('10-07'), themes: [{ id: 't-early', name: 'Cancelled early' }] },
        { id: 'r-legacy', status: 'succeeded', createdAt: fixture.at('10-06'), themes: [{ id: 't-legacy', name: 'Legacy run', evidenceIds: ['a', 'b', 'c'] }], reportRunIds: [{ themeId: 't-legacy', runId: 'c-legacy' }] },
        { id: 'r-passed', status: 'succeeded', approvedAt: fixture.at('10-05'), createdAt: fixture.at('10-05'), discoveredThemes: [{ id: 't-passed', name: 'Passed' }, { id: 't-kept', name: 'Kept' }], themes: [{ id: 't-kept', name: 'Kept', scoring: { taxonomy: { category: 'UNMAPPED' } }, taxonomyCategory: 'Fallback' }], reportRunIds: [{ themeId: 't-passed', runId: 'c-passed' }, { themeId: 't-kept', runId: 'c-kept' }] },
        { id: 'r-retry', status: 'partial', approvedAt: fixture.at('10-04'), createdAt: fixture.at('10-04'), themes: [{ id: 't-retry', name: 'First report failed' }], reportRunIds: [{ themeId: 't-retry', runId: 'c-retry-failed' }, { themeId: 't-retry', runId: 'c-retry-ok' }] },
        { id: 'r-running', status: 'running', createdAt: fixture.at('10-10'), themes: [] },
      ],
      contentRuns: ['c-review', 'c-cancelled', 'c-legacy', 'c-passed', 'c-kept', 'c-retry-ok'].map((id) => report(id, 'succeeded')).concat(report('c-retry-failed', 'failed')),
      assets: [file('a-cancelled', 'c-cancelled', 'evidence-report'), file('a-legacy', 'c-legacy', 'editorial-toolkit'), file('a-kept', 'c-kept', 'evidence-report'), file('a-kept-social', 'c-kept', 'social'), file('a-review', 'c-review', 'evidence-report')],
    };
    const ready = expectParity(studio);
    expect(ready.map((trend) => trend.themeId).sort()).toEqual(['t-cancelled', 't-kept', 't-legacy']);
    expect(ready.find((trend) => trend.themeId === 't-kept')).toMatchObject({ category: 'Fallback', primaryReportId: 'a-kept', reportAssets: [{ id: 'a-kept', deliverableId: 'evidence-report' }] });
    expect(ready.find((trend) => trend.themeId === 't-legacy')).toMatchObject({ evidenceCount: 3, primaryReportId: 'a-legacy' });
    expect(readyTrends({})).toEqual([]);
  });

  it('on a studio the real research pipeline produced', async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `source-${i}`, externalId: String(i), platform: 'x', author: `person${i}`, type: 'post', text: `Reporting problem ${i}: dashboards and pricing pages take too much manual work.`, url: `https://x.com/person${i}/status/${i}`, publishedAt: '2026-09-22T12:00:00Z', raw: { likeCount: 100, replyCount: 20, retweetCount: 10, quoteCount: 3, bookmarkCount: 5, viewCount: 1000 } }));
    const output = (request) => {
      const props = request.schema.properties;
      if (research.stageOf(request) === 'synthesis') { const ids = research.synthesisCandidates(request).map((c) => c.id); return { themes: ['Reporting workflow friction', 'Pricing page confusion'].map((name) => ({ name, description: `${name} described by sources.`, candidateIds: ids, novelty: 'NEW ANGLE', matchingKeywords: ['reporting'], matchingCriteria: 'Mentions the problem.', negativeCriteria: 'Unrelated posts.', taxonomyCategory: 'Workflow', contentGap: 'OPEN', gapRationale: '', recentTrend: 'DORMANT', crossPlatform: false, totalEvidence: ids.length })) }; }
      const staged = research.researchOutput(request); if (staged) return staged;
      const sectionIds = props.sections.items.properties.id.enum;
      const descriptor = content.CONTENT_DELIVERABLES.find((d) => d.kind === 'text' && JSON.stringify(d.sections.map((s) => s.id)) === JSON.stringify(sectionIds));
      const input = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
      const evidenceId = input.source.evidence[1]?.id || input.source.evidence[0].id;
      const result = { title: 'Trend evidence', summary: 'The supplied sample describes manual reporting work.', sections: descriptor.sections.map((section) => ({ id: section.id, heading: section.heading, body: 'This is a sampled observation. Validate the proposed next step with an editor.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Action ${i + 1}`, text: 'Review the reporting workflow.', evidenceIds: [evidenceId], productIds: [] })), evidenceIds: [evidenceId], productIds: [] })), caveats: ['The sample does not establish market prevalence. No approved product registry or verified quotation set was supplied.'] };
      if (descriptor.id === 'evidence-report') result.quotes = [];
      return result;
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-view-test-')); roots.push(root);
    const api = createContentWorkspace({ root, runAI: async (request) => ({ output: output(request), receipt: { costUsd: 0.001, provider: 'fixture', paid: false } }), cancelProvider: vi.fn(), getDatasets: () => [{ id: 'dataset-a', name: 'Example', platform: 'x', itemCount: items.length }], readDataset: async (id) => ({ items, id }) });
    const program = api.saveResearchProgram({ id: 'program-a', name: 'Weekly pulse', sourceGroups: [{ platform: 'x', targets: ['researcher'] }], window: { startDate: '2026-09-20', endDate: '2026-09-26' }, budgets: { collectionUsd: 1, aiUsd: 10 } });
    const started = api.startResearchRun({ programId: program.id, datasetIds: ['dataset-a'] }); await api.waitForIdle();
    const run = api.readStudioRun({ runId: started.id });
    expect(expectParity(api.publicState())).toEqual([]); // awaiting review: nothing is ready yet
    const reporting = run.themes.find((theme) => theme.name === 'Reporting workflow friction');
    api.approveResearchThemes({ runId: run.id, themes: [reporting.id] });
    api.continueResearchRun({ runId: run.id }); await api.waitForIdle();
    const ready = expectParity(api.publicState());
    expect(ready).toMatchObject([{ themeId: reporting.id, name: 'Reporting workflow friction', reportAssets: [{ deliverableId: expect.any(String) }, { deliverableId: expect.any(String) }] }]);
    const view = buildChannelView({ contentStudio: api.publicState(), channelId: 'blog', editionId: 'general' });
    expect(view).toMatchObject({ channel: { id: 'blog', name: 'Blog', short: 'Blog' }, counts: { newTrends: 1 }, trends: [{ themeId: reporting.id, isNew: true, latestRun: null, runCount: 0 }], runs: [], assets: [] });
  }, 60000);
});

describe('kit runs as a channel sees them', () => {
  const studio = fixture.contentStudio();
  const run = (id) => studio.contentRuns.find((entry) => entry.id === id);

  it('finds a kit run’s channels from its job ids, never the folder name', () => {
    expect(kitChannelIds(run('content-kit-shared'), 'semrush')).toEqual(['blog', 'social']);
    expect(kitChannelIds({ kit: {}, jobs: [{ id: 'social', folder: 'Semrush Blog' }] }, 'semrush')).toEqual(['social']);
    expect(kitChannelIds({ kit: {}, jobs: [{ id: 'sel' }, { id: 'sel-image' }] }, 'semrush')).toEqual(['searchengineland']);
    expect(kitChannelIds({ kit: {}, jobs: [{ id: 'sel' }, { id: 'sel-image' }] }, 'general')).toEqual(['searchengineland', 'other']);
    expect(kitChannelIds(run('content-report-aio-2'), 'semrush')).toEqual([]);
    expect(kitChannelIds(null)).toEqual([]);
  });

  it('strips costs, models, errors and other channels’ jobs', () => {
    const view = publicKitRun(run('content-kit-shared'), 'social', 'semrush');
    expect(view).toEqual({
      id: 'content-kit-shared', title: 'AI Overviews eat clicks', status: 'succeeded', message: 'All 4 files are ready.', progress: { done: 2, total: 2 },
      createdAt: fixture.at('10-13'), finishedAt: fixture.at('10-13'),
      kit: { sourceTitle: 'AI Overviews eat clicks', themeId: 'theme-aio', folderName: 'Golden Thread — AI Overviews eat clicks (2026-10-13)', reportAssetId: 'asset-aio-report-2' },
      shared: true,
      jobs: [
        { id: 'social', label: 'Social Team — LinkedIn + X + FB Captions', kind: 'text', status: 'succeeded', assetId: 'asset-kit-shared-social', assetIds: [] },
        { id: 'brand-image', label: 'Social Team — Hero Graphic', kind: 'image', status: 'succeeded', assetId: 'image-shared-0', assetIds: ['image-shared-0', 'image-shared-1', 'image-shared-2'] },
      ],
    });
    // The same run for the blog, whose one file failed while the social files were made.
    expect(publicKitRun(run('content-kit-shared'), 'blog', 'semrush')).toMatchObject({ status: 'failed', message: 'Some files didn’t finish. Try again.', progress: { done: 0, total: 1 }, shared: true, jobs: [{ id: 'blogshort', status: 'failed', assetId: null, assetIds: [] }] });
    expect(JSON.stringify(publicKitRun(run('content-kit-shared'), 'blog', 'semrush'))).not.toMatch(/budget|costUsd|receipts|claude|Social Team|folder"|imageCalls/i);
  });

  it('says what is happening in a fixed, plain set of messages', () => {
    const base = { id: 'k', kit: { sourceTitle: 'Trend' }, createdAt: fixture.at('10-15'), updatedAt: fixture.at('10-15', '11:00:00') };
    const blog = (status, extra = {}) => ({ ...base, status, ...extra });
    const two = (a, b, extra = {}) => [{ id: 'blogshort', status: a, ...extra }, { id: 'bloglong', status: b }];
    expect(publicKitRun(blog('queued', { jobs: two('queued', 'queued') }), 'blog', 'semrush')).toMatchObject({ status: 'queued', message: 'Starting…', finishedAt: null });
    expect(publicKitRun(blog('running', { message: 'Writing Semrush Social Team — Hero', jobs: two('succeeded', 'running', { assetId: 'a1' }) }), 'blog', 'semrush')).toMatchObject({ status: 'running', message: 'Writing 2 of 2…', progress: { done: 1, total: 2 }, finishedAt: null });
    expect(publicKitRun(blog('running', { jobs: two('running', 'queued') }), 'blog', 'semrush').message).toBe('Writing 1 of 2…');
    expect(publicKitRun(blog('succeeded', { jobs: [{ id: 'blogshort', status: 'succeeded', assetId: 'a1' }] }), 'blog', 'semrush').message).toBe('Your file is ready.');
    expect(publicKitRun(blog('partial', { jobs: two('succeeded', 'failed', { assetId: 'a1' }) }), 'blog', 'semrush')).toMatchObject({ status: 'partial', message: 'Some files didn’t finish. Try again.', finishedAt: fixture.at('10-15', '11:00:00') });
    expect(publicKitRun(blog('cancelled', { message: 'Cancelled. Completed outputs are retained.', jobs: two('succeeded', 'cancelled') }), 'blog', 'semrush')).toMatchObject({ status: 'cancelled', message: 'Stopped.' });
    for (const error of ['ANTHROPIC_API_KEY is not set.', 'Connect the image provider in Settings to generate this image.', 'Claude is not logged in. Run claude login.', 'Codex isn’t signed in.', '401 Unauthorized']) {
      expect(publicKitRun(blog('failed', { message: 'Some assets need another try.', jobs: [{ id: 'blogshort', status: 'failed', error }, { id: 'bloglong', status: 'failed' }] }), 'blog', 'semrush')).toMatchObject({ status: 'failed', message: 'Ask an admin: the AI connection needs attention.' });
    }
    // Another channel's key problem in a shared set is not this channel's message.
    expect(publicKitRun(blog('failed', { message: 'OPENAI_API_KEY is not set.', jobs: [{ id: 'blogshort', status: 'failed', error: 'Run budget exhausted.' }, { id: 'social', status: 'failed', error: 'OPENAI_API_KEY is not set.' }] }), 'blog', 'semrush').message).toBe('Some files didn’t finish. Try again.');
  });

  it('marks a failure only an admin can fix, so the card says so instead of offering another try', () => {
    const base = { id: 'k', kit: { sourceTitle: 'Trend' }, createdAt: fixture.at('10-15'), updatedAt: fixture.at('10-15', '11:00:00') };
    const failed = (error) => publicKitRun({ ...base, status: 'failed', jobs: [{ id: 'blogshort', status: 'failed', error }] }, 'blog', 'semrush');
    expect(failed('Add an Anthropic API key in Settings → Writing & research.')).toMatchObject({ needsAdmin: true, message: 'Ask an admin: the AI connection needs attention.' });
    expect(failed('Credit balance is too low to access the Anthropic API.')).toMatchObject({ needsAdmin: true });
    expect(failed('Claude timed out. Retry the incomplete output.')).not.toHaveProperty('needsAdmin');
    expect(publicKitRun({ ...base, status: 'succeeded', jobs: [{ id: 'blogshort', status: 'succeeded', error: 'ANTHROPIC_API_KEY is not set.' }] }, 'blog', 'semrush')).not.toHaveProperty('needsAdmin');
  });

  it('finishes a channel’s card once its own files are settled, even while the shared set runs on', () => {
    const base = { id: 'k', kit: { sourceTitle: 'Trend' }, createdAt: fixture.at('10-15'), updatedAt: fixture.at('10-15', '11:00:00'), status: 'running' };
    const shared = (blogStatus, extra = {}) => publicKitRun({ ...base, jobs: [{ id: 'blogshort', status: blogStatus, ...extra }, { id: 'social', status: 'running' }] }, 'blog', 'semrush');
    expect(shared('failed', { error: 'Validation failed twice.' })).toMatchObject({ status: 'failed', message: 'Some files didn’t finish. Try again.', shared: true });
    expect(shared('succeeded', { assetId: 'a1' })).toMatchObject({ status: 'succeeded', message: 'Your file is ready.' });
    expect(shared('running')).toMatchObject({ status: 'running', message: 'Writing 1 of 1…', finishedAt: null });
    expect(shared('queued')).toMatchObject({ status: 'running' }); // a retry puts files waiting for another try back in the queue
    // The Social owner, whose file is still being written, still sees progress.
    expect(publicKitRun({ ...base, jobs: [{ id: 'blogshort', status: 'failed' }, { id: 'social', status: 'running' }] }, 'social', 'semrush')).toMatchObject({ status: 'running' });
  });

  it('shows the newest set unless it is an unfinished shared set and an earlier one finished', () => {
    const studio = fixture.contentStudio();
    const card = (mutate) => { const copy = JSON.parse(JSON.stringify(studio)); mutate(copy); return buildChannelView({ contentStudio: copy, adoptions: [], channelId: 'blog', editionId: 'semrush' }).trends.find((trend) => trend.themeId === 'theme-aio').latestRun; };
    expect(card(() => {})).toMatchObject({ id: 'content-kit-blog', status: 'succeeded' });
    // Blog's own earlier set failed too: the newest set stays on the card.
    expect(card((copy) => { copy.contentRuns.find((run) => run.id === 'content-kit-blog').jobs.forEach((entry) => { entry.status = 'failed'; }); })).toMatchObject({ id: 'content-kit-shared', status: 'failed' });
    // A shared set still writing Blog's file is the newest news.
    expect(card((copy) => { const run = copy.contentRuns.find((entry) => entry.id === 'content-kit-shared'); run.status = 'running'; run.jobs[0].status = 'running'; })).toMatchObject({ id: 'content-kit-shared', status: 'running' });
    // Blog's own newest set that didn't finish stays on the card, where Finish the rest is.
    expect(card((copy) => { const run = copy.contentRuns.find((entry) => entry.id === 'content-kit-shared'); run.jobs = run.jobs.filter((entry) => entry.id === 'blogshort'); })).toMatchObject({ id: 'content-kit-shared', status: 'failed' });
  });
});

describe('the channel owner’s view', () => {
  const view = (channelId, extra = {}) => buildChannelView({ contentStudio: fixture.contentStudio(), adoptions: fixture.adoptions(), channelId, editionId: 'semrush', viewerId: 'member-alex', ...extra });

  it('holds only this channel’s runs and files, newest first', () => {
    const blog = view('blog');
    expect(blog.runs.map((entry) => entry.id)).toEqual(['content-kit-shared', 'content-kit-blog']);
    expect(blog.assets).toEqual([
      { id: 'asset-kit-blog-long', runId: 'content-kit-blog', themeId: 'theme-aio', deliverableId: 'bloglong', title: 'AI Overviews: the long read', kind: 'text', format: 'markdown', createdAt: fixture.at('10-12', '10:40:00'), variantIndex: null, edited: null, status: 'draft', link: '' },
      { id: 'asset-kit-blog-short', runId: 'content-kit-blog', themeId: 'theme-aio', deliverableId: 'blogshort', title: 'AI Overviews: a short news update', kind: 'text', format: 'markdown', createdAt: fixture.at('10-12', '10:20:00'), variantIndex: null, edited: { at: fixture.at('10-14'), byName: 'Alex' }, status: 'draft', link: '' },
    ]);
    const social = view('social');
    expect(social.runs.map((entry) => [entry.id, entry.status])).toEqual([['content-kit-local', 'running'], ['content-kit-shared', 'succeeded']]);
    expect(social.assets.map((asset) => [asset.id, asset.variantIndex])).toEqual([['image-shared-0', 0], ['image-shared-1', 1], ['image-shared-2', 2], ['asset-kit-shared-social', null]]);
    expect(view('pr')).toMatchObject({ channel: { id: 'pr', name: 'Semrush PR', short: 'PR', deliverables: [{ id: 'pr', label: 'PR research brief', kind: 'text' }] }, runs: [], assets: [] });
    expect(view('searchengineland').channel.deliverables.map((entry) => entry.kind)).toEqual(['text', 'image', 'image']);
    expect(view('nowhere')).toMatchObject({ channel: { id: 'nowhere', name: 'Your channel', short: '', deliverables: [] }, runs: [], assets: [], counts: { newTrends: 2 } });
  });

  it('puts each ready trend on a card with this channel’s answer and latest set', () => {
    const blog = view('blog');
    expect(blog.trends.map((trend) => trend.themeId)).toEqual(['theme-local', 'theme-aio']);
    const aio = blog.trends[1];
    expect(aio).toMatchObject({
      name: 'AI Overviews eat clicks', priority: 'top', primaryReportId: 'asset-aio-toolkit-2', briefEditedAt: fixture.at('10-12', '08:00:00'),
      adoption: { status: 'using', link: 'https://www.semrush.com/blog/ai-overviews/', note: '', at: fixture.at('10-13', '16:00:00'), byName: 'Alex', byMe: true },
      // The newest set (made with Social) failed Blog's file, which Alex can't finish; Blog's own earlier set did finish,
      // so the card shows that one and its drafts.
      isNew: false, earlier: false, runCount: 2, assetCount: 2, latestRun: { id: 'content-kit-blog', status: 'succeeded' },
    });
    expect(blog.trends[0]).toMatchObject({ themeId: 'theme-local', adoption: null, isNew: true, latestRun: null, runCount: 0, assetCount: 0 });
    expect(blog.counts).toEqual({ newTrends: 1 });
    const social = view('social', { viewerId: 'member-sam-2' });
    // Sam answered for social; an answer from another workspace doesn't count here.
    expect(social.trends.map((trend) => [trend.themeId, trend.adoption?.status || null, trend.adoption?.byMe ?? null, trend.latestRun?.id || null])).toEqual([['theme-local', 'not-using', false, 'content-kit-local'], ['theme-aio', null, null, 'content-kit-shared']]);
    expect(social.counts).toEqual({ newTrends: 1 });
  });

  it('sets trends that were ready more than 14 days before someone joined aside as earlier', () => {
    const local = fixture.at('10-11', '19:40:00'); const fourteen = 14 * 86400000;
    const joined = (ms) => view('blog', { memberSince: new Date(Date.parse(local) + ms).toISOString() }).trends.find((trend) => trend.themeId === 'theme-local');
    expect(joined(fourteen)).toMatchObject({ earlier: false, isNew: true });
    expect(joined(fourteen + 1)).toMatchObject({ earlier: true, isNew: false });
    expect(view('blog', { memberSince: '2027-01-01T00:00:00.000Z' })).toMatchObject({ counts: { newTrends: 0 } });
    // Answered trends are never earlier or new.
    expect(view('blog', { memberSince: '2027-01-01T00:00:00.000Z' }).trends.find((trend) => trend.themeId === 'theme-aio')).toMatchObject({ earlier: false, isNew: false });
    expect(view('blog', { memberSince: null }).trends.every((trend) => !trend.earlier)).toBe(true);
    expect(view('blog', { memberSince: 'not a date' }).trends.every((trend) => !trend.earlier)).toBe(true);
  });
});

describe('trends routed to channels', () => {
  // Riley said yes to Local packs for Social only, with a note; AI Overviews went to every channel.
  const routed = () => {
    const studio = fixture.contentStudio(); const run = studio.researchRuns.find((entry) => entry.id === 'research-new');
    run.decisionsBy['theme-local'] = { id: 'member-riley', name: 'Riley', at: fixture.at('10-10', '10:57:00'), note: 'Lead with the map pack data.', channels: ['social'] };
    return studio;
  };
  const view = (channelId) => buildChannelView({ contentStudio: routed(), adoptions: [], channelId, editionId: 'semrush', viewerId: 'member-alex' });

  it('says who suggested a trend for which channels, and counts it as new only where it was sent', () => {
    expect(readyTrends(routed()).find((trend) => trend.themeId === 'theme-local').decidedBy).toEqual({ name: 'Riley', at: fixture.at('10-10', '10:57:00'), auto: false, note: 'Lead with the map pack data.', channels: ['social'] });
    const social = view('social');
    expect(social.trends.find((trend) => trend.themeId === 'theme-local')).toMatchObject({ offered: true, forUs: true, isNew: true, decidedBy: { name: 'Riley', auto: false }, suggestion: { byName: 'Riley', note: 'Lead with the map pack data.', channels: [{ id: 'social', name: 'Semrush Social Team' }] } });
    expect(social.counts).toEqual({ newTrends: 2 });
    const blog = view('blog');
    expect(blog.trends.find((trend) => trend.themeId === 'theme-local')).toMatchObject({ offered: false, forUs: false, isNew: false });
    expect(blog.trends.find((trend) => trend.themeId === 'theme-aio')).toMatchObject({ offered: true, forUs: false, isNew: true, decidedBy: { name: 'Riley', auto: false }, suggestion: null });
    expect(blog.counts).toEqual({ newTrends: 1 });
  });

  it('names automatic approval as such and keeps each asset’s pipeline status', () => {
    const studio = fixture.contentStudio();
    studio.researchRuns.find((entry) => entry.id === 'research-new').decisionsBy['theme-aio'] = { id: 'system', name: 'Automatic', at: fixture.at('10-10', '11:00:00') };
    const asset = studio.assets.find((entry) => entry.id === 'asset-kit-blog-long'); asset.reviewStatus = 'published'; asset.review = { status: 'published', link: 'https://www.semrush.com/blog/aio/', at: fixture.at('10-15') };
    const blog = buildChannelView({ contentStudio: studio, adoptions: [], channelId: 'blog', editionId: 'semrush' });
    expect(blog.trends.find((trend) => trend.themeId === 'theme-aio').decidedBy).toMatchObject({ auto: true });
    expect(blog.assets.find((entry) => entry.id === 'asset-kit-blog-long')).toMatchObject({ status: 'published', link: 'https://www.semrush.com/blog/aio/' });
    expect(blog.assets.find((entry) => entry.id === 'asset-kit-blog-short')).toMatchObject({ status: 'draft', link: '' });
  });
});
