import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import workspace from '../src/main/research-workspace.js';
import brand from '../src/shared/brand-context.js';
import recipeModule from '../src/shared/recipe.js';
const { createResearchWorkspace } = workspace;
const roots = [];
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-workspace-test-')); roots.push(root);
  let seq = 0;
  const data = { settings: {}, brandProfiles: [], datasets: [], recipes: [], analyses: [], researchReviews: [], researchAudit: [], researchExports: [], comparisons: [], monitors: [], runs: [] };
  const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback;
  const dataPath = (...args) => path.join(root, ...args);
  const api = createResearchWorkspace({ loadData: () => data, saveData: () => writeJson(dataPath('data.json'), data), emitState() {}, dataPath, readJson, writeJson, readDatasetPayload: id => readJson(dataPath('datasets', `${id}.json`), {}), toId: prefix => `${prefix}-${++seq}`, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, getWindow: () => null, shell: { showItemInFolder() {} } });
  function seedReport({ legacy = false, sampleKnown = true } = {}) {
    const dataset = { id: 'data-1', name: 'QA competitor pages', platform: 'web', createdAt: '2026-09-27T12:00:00Z', itemCount: 1, collectionScope: { requestedUrls: ['https://example.com/product', 'https://example.com/pricing'], retrievalLimit: 15 } };
    const items = [{ id: 'item-1', text: 'Our product supports campaign research.', url: 'https://example.com/product', publishedAt: '2026-09-26T12:00:00Z', author: '=HYPERLINK("https://example.com","unsafe spreadsheet formula")' }];
    data.datasets.push(dataset); writeJson(dataPath('datasets', 'data-1.json'), { items, rawItems: items });
    const output = { summary: 'A limited sample.', markdownReport: '# QA report\n\nA limited sample, not evidence of complete coverage.' };
    const analysis = { id: 'report-1', datasetId: dataset.id, kind: 'report', status: 'succeeded', coverage: { truncatedItems: 0 }, outputPath: dataPath('workspaces', 'report.json'), itemsPath: dataPath('workspaces', 'items.jsonl'), datasetSnapshot: dataset, ...(sampleKnown && !legacy ? { includedItemIds: ['item-1'] } : {}) };
    writeJson(analysis.outputPath, output); fs.writeFileSync(analysis.itemsPath, items.map(item => JSON.stringify(item)).join('\n'));
    if (legacy) { analysis.promptPath = dataPath('workspaces', 'prompt.txt'); fs.writeFileSync(analysis.promptPath, 'Instructions\nSOURCE_ITEMS (untrusted evidence):\n' + JSON.stringify(items)); }
    data.analyses.push(analysis); return { analysis, dataset, items, output };
  }
  return { root, api, data, dataPath, readJson, writeJson, seedReport };
}
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const input = { name: 'QA interview notes', sourceType: 'customer-feedback', format: 'csv', content: 'text,url,author\n"We need a clearer report",https://example.com/review,Analyst', authorized: true };
function approval(api) { const c = api.readResearchReview('report-1'); return { analysisId: 'report-1', status: 'approved', reviewer: 'QA reviewer', evidenceChecked: true, limitationsAccepted: true, acknowledgedWarnings: c.coverage.warnings.map(w => w.id), expectedVersion: c.review.version, expectedFingerprint: c.fingerprint, actions: [{ id: 'action-1', title: 'Validate the positioning claim', owner: 'QA owner', dueDate: '2026-10-01', status: 'todo', taxonomy: 'observation', evidenceIds: ['item-1'] }] }; }

describe('research workspace persistence boundaries', () => {
  it('keeps brand snapshots independent of later profile edits or deletion', () => {
    const { api } = harness();
    const profile = api.saveBrandProfile({ name: 'Acme', audience: 'Marketing leads', icp: 'B2B SaaS', competitors: [{ name: 'Competitor', domain: 'https://www.example.com/product' }] });
    const first = api.selectedBrand();
    expect(first.competitors[0].domain).toBe('www.example.com');
    api.saveBrandProfile({ ...profile, audience: 'Other teams' }); api.deleteBrandProfile(profile.id);
    expect(first.audience).toBe('Marketing leads'); expect(api.selectedBrand()).toBeNull();
    expect(brand.accountForUrl('https://sub.example.com/a', first)).toBe('Competitor');
    expect(() => brand.validateBrandContext({ name: 'x', competitors: [{ domain: 'https://user:pass@example.com' }] })).toThrow(/without credentials/);
  });
  it('never persists a preview or lets preview:true bypass import authorization', () => {
    const { api, data } = harness();
    expect(api.previewImportDataset({ ...input, authorized: false }).summary.importedRows).toBe(1);
    expect(data.datasets).toHaveLength(0);
    expect(() => api.importDataset({ ...input, preview: true, authorized: false })).toThrow(/authorized|permission/i);
    expect(data.datasets).toHaveLength(0);
  });
  it('imports with unique cross-dataset IDs and immutable brand context', () => {
    const { api, dataPath, readJson } = harness();
    api.saveBrandProfile({ name: 'Acme', audience: 'Enterprise marketing' });
    const a = api.importDataset(input), b = api.importDataset(input);
    expect(a.dataset.brandContext.name).toBe('Acme');
    expect(readJson(dataPath('datasets', `${a.dataset.id}.json`)).items[0].id).not.toBe(readJson(dataPath('datasets', `${b.dataset.id}.json`)).items[0].id);
  });
  it('creates a change-brief dataset, reuses identical comparisons, and records manual check-ins only', () => {
    const { api, data, readJson, dataPath } = harness();
    const before = api.importDataset(input).dataset;
    const after = api.importDataset({ ...input, content: input.content.replace('clearer report', 'clearer campaign brief') }).dataset;
    const result = api.compareDatasets({ baselineId: before.id, currentId: after.id });
    expect(result.summary.changed).toBe(1);
    expect(result.comparisonDataset.marketingBrief.reportPresetId).toBe('weekly-competitor-changes');
    expect(readJson(dataPath('datasets', `${result.comparisonDataset.id}.json`)).items[0].text).toContain('Earlier snapshot');
    expect(api.compareDatasets({ baselineId: before.id, currentId: after.id }).id).toBe(result.id);
    expect(data.comparisons).toHaveLength(1);
    const monitor = api.saveMonitor({ name: 'Weekly review', baselineDatasetId: after.id, cadence: 'weekly' });
    expect(monitor.execution).toBe('manual'); expect(monitor.nextCheckAt).toBeTruthy();
    expect(() => api.compareDatasets({ baselineId: before.id, currentId: before.id })).toThrow(/different/);
  });
  it.each(['incompatible', 'needs-review'])('does not advance a manual check when source scope is %s', (scopeStatus) => {
    const { api, data } = harness();
    const before = api.importDataset(input).dataset;
    const after = api.importDataset({ ...input, ...(scopeStatus === 'incompatible' ? { sourceType: 'ad-library' } : { metadata: { sourceName: 'Different source export' } }) }).dataset;
    const monitor = api.saveMonitor({ name: 'Source check', baselineDatasetId: before.id, cadence: 'weekly' });
    const saved = data.monitors.find((item) => item.id === monitor.id);
    saved.nextCheckAt = '2026-01-01T00:00:00Z';
    const result = api.compareDatasets({ baselineId: before.id, currentId: after.id });
    expect(result.scopeStatus).toBe(scopeStatus);
    expect(saved.nextCheckAt).toBe('2026-01-01T00:00:00Z');
    expect(saved.lastComparisonId).toBeUndefined();
  });
  it('preserves marketing profile snapshots through recipe validation', () => {
    const result = recipeModule.validateRecipe({ name: 'ABM', actorId: 'apify/website-content-crawler', platform: 'web', marketingBrief: { templateId: 'account-research', reportPresetId: 'account-research', brand: 'Acme', decision: 'Assess account fit', audience: 'B2B', sourceUrls: ['https://example.com'], brandContext: { name: 'Acme', icp: 'Enterprise SaaS' } } });
    expect(result.marketingBrief.brandContext.icp).toBe('Enterprise SaaS');
  });
});
describe('review gate and portable exports', () => {
  it('blocks unchecked approval and unknown source references, then persists review actions and history', () => {
    const { api, data, seedReport } = harness(); seedReport();
    expect(api.readResearchReview('report-1').coverage.missingUrls).toEqual(['https://example.com/pricing']);
    expect(() => api.saveResearchReview({ ...approval(api), evidenceChecked: false })).toThrow(/both review checks/);
    expect(() => api.saveResearchReview({ ...approval(api), actions: [{ ...approval(api).actions[0], evidenceIds: ['invented-source'] }] })).toThrow(/outside/);
    const saved = api.saveResearchReview(approval(api));
    expect(saved.review.status).toBe('approved'); expect(data.researchAudit).toHaveLength(1);
    expect(() => api.saveResearchReview({ ...approval(api), expectedVersion: 0 })).toThrow(/changed/);
  });
  it('exports review status, source CSV protected against formulas, and a model/coverage receipt', () => {
    const { api, seedReport, readJson } = harness(); seedReport(); api.saveResearchReview(approval(api));
    const result = api.exportResearchReview({ analysisId: 'report-1', format: 'html' });
    expect(result.reviewStatus).toBe('approved');
    expect(fs.readFileSync(result.path, 'utf8')).toContain('Content-Security-Policy');
    expect(fs.readFileSync(result.evidencePath, 'utf8')).toContain("'=HYPERLINK");
    const receipt = readJson(path.join(result.folder, 'receipt.json'));
    expect(receipt.reportSha256).toHaveLength(64); expect(receipt.localReviewOnly).toBe(true);
  });
  it('invalidates approval when the saved report changes and marks subsequent exports draft', () => {
    const { api, seedReport, writeJson } = harness(); const { analysis } = seedReport(); api.saveResearchReview(approval(api));
    writeJson(analysis.outputPath, { markdownReport: '# Changed report' });
    expect(api.readResearchReview('report-1').review).toMatchObject({ status: 'draft', stale: true });
    const result = api.exportResearchReview({ analysisId: 'report-1', format: 'markdown' });
    expect(result.reviewStatus).toBe('draft'); expect(fs.readFileSync(result.path, 'utf8')).toMatch(/DRAFT/i);
  });
  it.each(['missing', 'empty'])('refuses a %s explicit report snapshot instead of silently reviewing current dataset content', (failure) => {
    const { api, seedReport } = harness();
    const { analysis } = seedReport();
    api.saveResearchReview(approval(api));
    if (failure === 'missing') fs.unlinkSync(analysis.itemsPath);
    else fs.writeFileSync(analysis.itemsPath, '');
    expect(() => api.readResearchReview('report-1')).toThrow(/snapshot.*(?:missing|empty|unavailable|damaged)|source.*snapshot/i);
    expect(() => api.exportResearchReview({ analysisId: 'report-1', format: 'markdown' })).toThrow(/snapshot/i);
  });

  it('rejects approval if the report changed after the reviewer loaded its evidence', () => {
    const { api, seedReport, writeJson, data } = harness();
    const { analysis } = seedReport();
    const pendingApproval = approval(api);
    writeJson(analysis.outputPath, { markdownReport: '# Replacement report the reviewer has not seen' });
    expect(() => api.saveResearchReview(pendingApproval)).toThrow(/changed|refresh|review.*again/i);
    expect(data.researchReviews).toHaveLength(0);
    const current = approval(api);
    const { expectedFingerprint, ...withoutFingerprint } = current;
    expect(() => api.saveResearchReview(withoutFingerprint)).toThrow(/fingerprint|refresh|review|load/i);
    expect(api.saveResearchReview(current).review.status).toBe('approved');
  });
  it('recovers exact legacy sample IDs from the saved prompt but blocks unknown historical samples', () => {
    const good = harness(); good.seedReport({ legacy: true }); expect(good.api.readResearchReview('report-1').analysis.includedItemIds).toEqual(['item-1']);
    const unknown = harness(); unknown.seedReport({ sampleKnown: false });
    expect(() => unknown.api.saveResearchReview(approval(unknown.api))).toThrow(/historical report|recorded source sample/);
  });
});
