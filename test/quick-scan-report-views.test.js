import { describe, expect, it } from 'vitest';
import { buildLibraryTree, filterLibrary, folderSummary, groupReports, pathTo } from '../src/shared/library-tree.js';
import { buildInbox } from '../src/renderer/src/inbox-model.js';
import { nextSteps } from '../src/renderer/src/next-steps.js';

// Where a quick scan's short trends report shows (SPEC-3): under its scan in the Library (and the sets and drafts made from
// it with it), as its own row in Reports, and once in the Inbox. A report that didn't finish is the scan's to retry.
const at = (time) => `2026-10-17T${time}:00Z`;
const scan = (extra = {}) => ({ id: 'q-scan', workspaceId: 'ws', type: 'research', origin: 'quick-scan', programId: 'p1', title: 'Quick scan · AI Overviews', status: 'succeeded', stage: 'scan-complete', createdAt: at('10:00'), updatedAt: at('10:20'), quickScan: { topic: 'AI Overviews', lookbackHours: 6, report: true }, discoveredThemes: [{ id: 't1', name: 'Fast trend' }, { id: 't2', name: 'Quiet trend' }], themes: [], scanReport: { runId: 'c-scan-report', status: 'succeeded', assetId: 'a-scan-report' }, ...extra });
const child = (extra = {}) => ({ id: 'c-scan-report', workspaceId: 'ws', type: 'content', title: 'Quick scan report: AI Overviews (2026-10-17)', researchRunId: 'q-scan', scanReport: true, status: 'succeeded', createdAt: at('10:15'), updatedAt: at('10:20'), jobs: [{ id: 'scan-report', status: 'succeeded', assetId: 'a-scan-report' }], ...extra });
const reportAsset = { id: 'a-scan-report', workspaceId: 'ws', runId: 'c-scan-report', deliverableId: 'scan-report', title: 'Quick scan report: AI Overviews (2026-10-17)', kind: 'text', channel: 'Research', createdAt: at('10:20'), reviewStatus: 'draft' };
const kit = { id: 'k-scan', workspaceId: 'ws', type: 'content', title: 'AI Overviews', sourceAssetId: 'a-scan-report', status: 'succeeded', createdAt: at('11:00'), kit: { version: 1, sourceKey: 'report:a-scan-report', sourceKind: 'report', sourceTitle: 'Quick scan report: AI Overviews', folderName: 'Golden Thread — AI Overviews', reportAssetId: 'a-scan-report' }, jobs: [{ id: 'blogshort', label: 'Blog — Short News Update', kind: 'text', status: 'succeeded' }] };
const kitFile = { id: 'a-kit-blog', workspaceId: 'ws', runId: 'k-scan', deliverableId: 'blogshort', title: 'Blog — Short News Update', kind: 'text', createdAt: at('11:05'), reviewStatus: 'draft' };
const draft = { id: 'd-scan', workspaceId: 'ws', type: 'content', title: 'Social follow-up', sourceAssetId: 'a-scan-report', status: 'succeeded', createdAt: at('11:10'), jobs: [{ id: 'social', status: 'succeeded' }] };
const draftFile = { id: 'a-draft-social', workspaceId: 'ws', runId: 'd-scan', deliverableId: 'social', title: 'Social posts', kind: 'text', createdAt: at('11:12'), reviewStatus: 'draft' };

describe('Library tree', () => {
  const tree = buildLibraryTree({ researchRuns: [scan()], contentRuns: [child(), kit, draft], assets: [reportAsset, kitFile, draftFile], editionId: 'semrush', now: Date.parse(at('12:00')) });
  it('files the report under its quick scan, not in Drafts without a trend', () => {
    const folder = tree.nodes['research:q-scan'];
    expect(folder).toMatchObject({ type: 'research-run', title: 'Quick scan · AI Overviews', meta: { origin: 'quick-scan', scanReportAssetId: 'a-scan-report', themeCount: 2 } });
    const item = tree.itemsByKey['studio:a-scan-report'];
    expect(item).toMatchObject({ type: 'scan-report', label: 'Quick scan report', channelId: 'research', location: 'research:q-scan' });
    expect(tree.nodes['loose-drafts']?.children || []).not.toContain('draft-run:c-scan-report');
    expect(folderSummary(folder)).toBe('2 trends · Quick scan report · 2 files');
  });
  it('files drafts made from it under the same scan, and its channel asset sets by their source', () => {
    expect(tree.nodes['drafts:research:q-scan'].itemKeys).toContain('studio:a-draft-social');
    expect(pathTo(tree, tree.itemsByKey['studio:a-kit-blog'].location).map((node) => node.id)[0]).toBe('other-sources');
    expect(tree.nodes['source:report:a-scan-report']).toMatchObject({ meta: { sourceKind: 'report', reportAssetId: 'a-scan-report' } });
  });
  it('finds it with the Quick scan reports filter, and lists it as its own Reports row', () => {
    expect(filterLibrary(tree, { types: ['scan-report'] }).items.map((item) => item.id)).toEqual(['a-scan-report']);
    expect(groupReports(tree)).toEqual([expect.objectContaining({ kind: 'scan', reportId: 'a-scan-report', title: 'Quick scan · AI Overviews' })]);
  });
  it('shows the scan as writing while the report is being written', () => {
    const writing = buildLibraryTree({ researchRuns: [scan({ status: 'running', stage: 'scan-report', scanReport: { runId: 'c-scan-report', status: 'running' } })], contentRuns: [child({ status: 'running', jobs: [{ id: 'scan-report', status: 'running' }] })], assets: [], editionId: 'semrush' });
    expect(writing.nodes['research:q-scan']).toMatchObject({ live: true, liveText: 'Writing the trends report…' });
  });
});

describe('Inbox and Next up', () => {
  const state = (researchRuns, contentRuns, assets) => ({ contentStudio: { activeWorkspaceId: 'ws', workspaces: [{ id: 'ws', editionId: 'semrush' }], researchRuns, contentRuns, assets, programs: [] } });
  const now = Date.parse(at('12:00'));
  it('says the report is ready once, on the scan’s row, opening the report', () => {
    const { items } = buildInbox({ state: state([scan()], [child()], [reportAsset]), viewer: { id: 'me' }, now });
    const rows = items.filter((item) => item.kind === 'run-finished');
    expect(rows).toEqual([expect.objectContaining({ id: 'run:q-scan', title: 'Quick scan report ready · “AI Overviews”', detail: '2 trends', target: { kind: 'report', id: 'a-scan-report', page: 'reports' } })]);
  });
  it('says when the report didn’t finish, without a row of its own for the report run', () => {
    const failedScan = scan({ scanReport: { runId: 'c-scan-report', status: 'failed', error: 'It stopped early.' } });
    const failedChild = child({ status: 'failed', jobs: [{ id: 'scan-report', status: 'failed' }] });
    const { items } = buildInbox({ state: state([failedScan], [failedChild], []), viewer: { id: 'me' }, now });
    expect(items.map((item) => item.id)).toEqual(['run:q-scan']);
    expect(items[0]).toMatchObject({ title: 'Quick scan finished · “AI Overviews”', detail: '2 trends · its trends report didn’t finish' });
    const steps = nextSteps({ state: state([failedScan], [failedChild], []), viewer: { id: 'me' }, can: () => true, now });
    expect(steps.find((row) => row.id === 'stopped:c-scan-report')).toMatchObject({ title: 'Quick scan report didn’t finish · AI Overviews', action: { kind: 'retry', runId: 'c-scan-report', label: 'Retry report' } });
  });
});
