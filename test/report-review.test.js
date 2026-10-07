import { describe, expect, it } from 'vitest';
import reviewModule from '../src/shared/report-review.js';
const { assessDatasetCoverage, buildEvidenceRegister, validateResearchReview, renderReviewExport, canonicalSourceUrl } = reviewModule;
const dataset = { id: 'dataset-a', name: 'Brand pages', createdAt: '2026-09-27T12:00:00Z', collectionScope: { requestedUrls: ['https://brand.example/'], retrievalLimit: 15 } };
const items = [{ id: 'run:1', url: 'https://brand.example/#pricing', text: 'Plans start at $20 per month.', author: 'Brand', publishedAt: '2026-09-20' }];
const analysis = { id: 'analysis-a', datasetId: dataset.id, kind: 'report', status: 'succeeded', includedItemIds: ['run:1'], coverage: { truncatedItems: 0 }, finishedAt: '2026-09-27T13:00:00Z' };
const output = { title: 'Positioning report', summary: 'One page advertises a monthly plan.', markdownReport: '## Findings\n\nPlans start at $20.' };
function context(overrides = {}) {
  const data = { dataset, items, analysis, output, ...overrides };
  return { ...data, coverage: assessDatasetCoverage(data), evidence: buildEvidenceRegister({ ...data, includedItemIds: data.analysis.includedItemIds }) };
}
function input(ctx, extra = {}) { return { analysisId: ctx.analysis.id, status: 'approved', reviewer: 'Chris', notes: '', evidenceChecked: true, limitationsAccepted: true, acknowledgedWarnings: ctx.coverage.warnings.map((warning) => warning.id), actions: [], ...extra }; }

describe('source coverage', () => {
  it('compares canonical stored page URLs conservatively without claiming deletion or full market coverage', () => {
    const ctx = context({ dataset: { ...dataset, collectionScope: { requestedUrls: ['https://brand.example/', 'https://brand.example/pricing?plan=team', 'https://brand.example/pricing/'] } } });
    expect(ctx.coverage.retrievedUrls).toEqual(['https://brand.example/']);
    expect(ctx.coverage.missingUrls).toHaveLength(2);
    expect(ctx.coverage.warnings.find((entry) => entry.id === 'missing-requested-pages').message).toContain('not proof');
    expect(canonicalSourceUrl('https://brand.example/pricing?plan=team#section')).toBe('https://brand.example/pricing?plan=team');
    expect(ctx.coverage.counts.usableIncluded).toBe(1);
  });

  it('reports textless, repeated, ambiguous and outside-sample rows instead of silently treating them as independent evidence', () => {
    const ctx = context({ items: [...items, { ...items[0], id: 'run:2' }, { id: 'run:3', text: '', url: 'javascript:alert(1)' }, { id: 'ambiguous', text: 'A' }, { id: 'ambiguous', text: 'B' }, { text: 'No ID' }] });
    expect(ctx.coverage.counts).toMatchObject({ total: 6, textless: 1, duplicateRows: 1, ambiguousIds: 1, missingIds: 1, included: 1, omitted: 5, usableIncluded: 1 });
    expect(ctx.evidence.map((row) => row.id)).toEqual(['run:1', 'run:2', 'run:3']);
    expect(ctx.evidence.find((row) => row.id === 'run:3').url).toBe('');
    expect(ctx.coverage.warnings.map((entry) => entry.id)).toEqual(expect.arrayContaining(['duplicate-records', 'outside-analysis-sample', 'unlinked-records']));
  });

  it('distinguishes a retrieval cap from confirmed truncation and never substitutes collection time for publication', () => {
    const ctx = context({ dataset: { ...dataset, collectionScope: { retrievalLimit: 1 } }, items: [{ ...items[0], publishedAt: '2026-02-31' }] });
    expect(ctx.evidence[0]).toMatchObject({ publishedAt: '', collectedAt: '2026-09-27T12:00:00.000Z', collectedAtBasis: 'dataset saved time; per-page capture not verified' });
    expect(ctx.coverage.warnings.map((entry) => entry.id)).toContain('collection-limit-reached');
    expect(ctx.coverage.warnings.map((entry) => entry.id)).not.toContain('collection-truncated');
    expect(ctx.coverage.requestedScopeKnown).toBe(false);
  });
});

describe('local approval gate', () => {
  it('keeps historical reports as readable drafts when the source sample is unknown', () => {
    const ctx = context({ analysis: { ...analysis, includedItemIds: undefined } });
    expect(ctx.coverage.blockers.map((entry) => entry.id)).toContain('unknown-analysis-sample');
    expect(() => validateResearchReview(input(ctx), ctx)).toThrow(/Approval blocked/);
    expect(renderReviewExport({ ...ctx, format: 'markdown' })).toContain('DRAFT — NOT APPROVED');
  });

  it.each([
    ['missing included text', { items: [{ ...items[0], text: '' }] }],
    ['missing sampled ID', { analysis: { ...analysis, includedItemIds: ['missing'] } }],
    ['failed report', { analysis: { ...analysis, status: 'failed' } }],
    ['wrong dataset', { dataset: { ...dataset, id: 'other' } }],
  ])('blocks approval with %s', (_, overrides) => {
    const ctx = context(overrides);
    expect(() => validateResearchReview(input(ctx), ctx)).toThrow();
    expect(validateResearchReview(input(ctx, { status: 'draft' }), ctx).status).toBe('draft');
  });

  it('requires real booleans, a reviewer, every current warning, and available output', () => {
    const ctx = context({ dataset: { ...dataset, collectionScope: {} } });
    expect(() => validateResearchReview(input(ctx, { reviewer: ' ' }), ctx)).toThrow(/Reviewer/);
    expect(() => validateResearchReview(input(ctx, { evidenceChecked: 'true' }), ctx)).toThrow(/both review checks/);
    expect(() => validateResearchReview(input(ctx, { acknowledgedWarnings: [] }), ctx)).toThrow(/every coverage limitation/);
    expect(() => validateResearchReview(input(ctx), { ...ctx, output: {} })).toThrow(/output is unavailable/);
  });

  it('validates action owners, observations, exact source IDs and real dates', () => {
    const ctx = context();
    const action = { id: 'action-a', title: 'Test a new message', owner: 'Pat', dueDate: '2026-10-02', status: 'todo', taxonomy: 'observation', evidenceIds: ['run:1'] };
    expect(validateResearchReview(input(ctx, { actions: [action] }), ctx).actions[0]).toEqual(action);
    expect(() => validateResearchReview(input(ctx, { actions: [{ ...action, owner: '' }] }), ctx)).toThrow(/owner/);
    expect(() => validateResearchReview(input(ctx, { actions: [{ ...action, evidenceIds: [] }] }), ctx)).toThrow(/source reference/);
    expect(() => validateResearchReview(input(ctx, { actions: [{ ...action, evidenceIds: ['invented'] }] }), ctx)).toThrow(/outside/);
    expect(() => validateResearchReview(input(ctx, { actions: [{ ...action, dueDate: '2026-02-31' }] }), ctx)).toThrow(/valid/);
  });

  it('binds approved exports to the saved evidence and output fingerprint', () => {
    const ctx = context();
    const saved = validateResearchReview(input(ctx), ctx);
    expect(renderReviewExport({ ...ctx, review: saved })).toContain('APPROVED — LOCAL REVIEW');
    expect(() => renderReviewExport({ ...ctx, review: saved, output: { ...output, summary: 'Changed' } })).toThrow(/changed after approval/);
    expect(() => renderReviewExport({ ...ctx, review: saved, evidence: [{ ...ctx.evidence[0], text: 'Different evidence' }] })).toThrow(/changed after approval/);
  });

  it('escapes untrusted content in printable HTML and makes draft status explicit', () => {
    const ctx = context({ output: { title: '<script>bad()</script>', summary: '<img src="https://tracker.example">', markdownReport: '[link](javascript:bad())\n```\n![remote](https://tracker.example)' } });
    const html = renderReviewExport({ ...ctx, format: 'html' });
    expect(html).toContain('DRAFT — NOT APPROVED');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('default-src');
    const markdown = renderReviewExport({ ...ctx, format: 'markdown' });
    expect(markdown).toContain('````text\n[link](javascript:bad())');
    expect(markdown).toContain('self-reported locally');
  });
});

describe('import capture provenance', () => {
  it('uses supplied import capture dates separately from publication and dataset-save timestamps', () => {
    const ctx = context({ dataset: { ...dataset, platform: 'import', importMetadata: { collectedAt: '2026-08-20', sourceName: 'Authorized export', inputRows: 4, skippedRows: 1, duplicateRows: 2 } }, items: [{ ...items[0], publishedAt: '', provenance: { sourceType: 'serp', sourceName: 'Search export', sourceRow: 7, resultIndex: 2, contentHash: 'sha256-example', collectedAt: '2026-08-19' } }] });
    expect(ctx.evidence[0]).toMatchObject({ collectedAt: '2026-08-19T00:00:00.000Z', collectedAtBasis: 'user-supplied import capture time', sourceName: 'Search export', sourceRow: 7, resultIndex: 2, contentHash: 'sha256-example', publishedAt: '' });
    expect(ctx.coverage).toMatchObject({ collectedAt: '2026-08-20T00:00:00.000Z', collectedAtBasis: 'user-supplied import capture time' });
    expect(ctx.coverage.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining(['import-skipped-rows', 'import-duplicate-rows']));
  });
});
