const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateBrandContext } = require('../shared/brand-context');
const { validateId } = require('../shared/validation');
const { isPathInside } = require('../shared/workspace');
const Papa = require('papaparse');
const { prepareImport, compareSnapshots } = require('../shared/research-data');
const { assessDatasetCoverage, buildEvidenceRegister, validateResearchReview, renderReviewExport, reviewContentFingerprint } = require('../shared/report-review');

function createResearchWorkspace({ loadData, saveData, emitState, dataPath, readJson, writeJson, readDatasetPayload, toId, dialog, getWindow, shell }) {
  const timestamp = () => new Date().toISOString();
  const persist = () => { saveData(); emitState(); };
  function selectedBrand() {
    const data = loadData();
    const profile = data.brandProfiles.find(item => item.id === data.settings.selectedBrandProfileId);
    return profile ? { ...validateBrandContext(profile), profileId: profile.id, savedAt: profile.updatedAt } : null;
  }
  function saveBrandProfile(payload = {}) {
    const data = loadData();
    const existing = payload.id ? data.brandProfiles.find(item => item.id === validateId(payload.id, 'Brand profile ID')) : null;
    if (payload.id && !existing) throw new Error('Brand profile no longer exists.');
    const profile = { ...validateBrandContext(payload), id: existing?.id || toId('brand'), createdAt: existing?.createdAt || timestamp(), updatedAt: timestamp() };
    data.brandProfiles = [profile, ...data.brandProfiles.filter(item => item.id !== profile.id)];
    data.settings.selectedBrandProfileId = profile.id;
    persist(); return profile;
  }
  function selectBrandProfile(value) {
    const data = loadData();
    if (value && !data.brandProfiles.some(item => item.id === value)) throw new Error('Brand profile not found.');
    data.settings.selectedBrandProfileId = value || ''; persist(); return selectedBrand();
  }
  function deleteBrandProfile(value) {
    const id = validateId(value, 'Brand profile ID'), data = loadData();
    data.brandProfiles = data.brandProfiles.filter(item => item.id !== id);
    if (data.settings.selectedBrandProfileId === id) data.settings.selectedBrandProfileId = '';
    persist(); return { id, deleted: true };
  }
  async function pickImportFile() {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Import research data', properties: ['openFile'], filters: [{ name: 'Research data', extensions: ['csv', 'json', 'jsonl', 'ndjson'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0], stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Choose a CSV, JSON or JSONL file up to 5 MB.');
    const format = path.extname(file).slice(1).toLowerCase();
    if (!['csv', 'json', 'jsonl', 'ndjson'].includes(format)) throw new Error('Choose CSV, JSON or JSONL data.');
    return { name: path.basename(file), format: format === 'ndjson' ? 'jsonl' : format, content: fs.readFileSync(file, 'utf8') };
  }
  function previewImportDataset(payload = {}) {
    const result = prepareImport({ ...payload, preview: true });
    return { ...result.summary, summary: result.summary, dataset: result.dataset };
  }
  function importDataset(payload = {}) {
    const data = loadData();
    // This boundary overrides renderer flags. Preview is never import authorization.
    const result = prepareImport({ ...payload, preview: false });
    if (payload.authorized !== true) throw new Error('Confirm you are authorized to import this research data.');
    const id = toId('dataset'), createdAt = timestamp();
    const selected = selectedBrand();
    const importBrand = String(payload.brandContext?.brand || '').trim();
    const brandSnapshot = selected && (!importBrand || selected.name === importBrand) ? selected : null;
    const items = result.items.map(item => ({ ...item, id: `${id}:${item.id}` }));
    const dataset = { ...result.dataset, id, projectId: 'default', platform: 'import', itemCount: items.length, createdAt, brandContext: brandSnapshot, collectionScope: { returnedRows: items.length, requestedUrls: [], retrievalLimit: 5000, imported: true } };
    writeJson(dataPath('datasets', `${id}.json`), { rawItems: result.rawItems, items });
    data.datasets.unshift(dataset); persist();
    return { dataset, summary: result.summary };
  }
  function getDataset(id) {
    const dataset = loadData().datasets.find(item => item.id === validateId(id, 'Dataset ID'));
    if (!dataset) throw new Error('Dataset not found.');
    return { dataset, items: readDatasetPayload(dataset.id).items || [] };
  }
  function compareDatasets(payload = {}) {
    if (payload.baselineId === payload.currentId) throw new Error('Choose two different snapshots.');
    const result = compareSnapshots({ baseline: getDataset(payload.baselineId), current: getDataset(payload.currentId) });
    const data = loadData();
    const existing = data.comparisons.find(item => item.baselineId === payload.baselineId && item.currentId === payload.currentId && JSON.stringify(item.changes) === JSON.stringify(result.changes));
    if (existing) return existing;
    const record = { id: toId('comparison'), baselineId: payload.baselineId, currentId: payload.currentId, createdAt: timestamp(), ...result };
    if (result.scopeStatus !== 'incompatible' && result.changes.length) {
      const id = toId('dataset');
      const items = result.changes.map((change, index) => ({
        id: `${id}:change-${index + 1}`, type: 'snapshot-change', platform: 'comparison', url: change.url, author: '', publishedAt: '', metrics: {},
        text: [`Observation: ${change.status}`, `Source: ${change.url}`, `Earlier snapshot: ${change.beforeCollectedAt || 'date unknown'}`, change.beforeExcerpt || '[No usable earlier text]', `Current snapshot: ${change.afterCollectedAt || 'date unknown'}`, change.afterExcerpt || '[No usable current text]', change.reason || '', 'Unavailable does not establish removal. New means newly observed in this sample, not necessarily newly published.', ...result.warnings].filter(Boolean).join('\n'),
        comparison: { status: change.status, baselineDatasetId: payload.baselineId, currentDatasetId: payload.currentId, beforeCollectedAt: change.beforeCollectedAt, afterCollectedAt: change.afterCollectedAt },
      }));
      const dataset = { id, projectId: 'default', name: `Change brief · ${result.current?.name || 'Current snapshot'}`, platform: 'comparison', sourceType: 'snapshot-comparison', itemCount: items.length, createdAt: record.createdAt, comparisonId: record.id, brandContext: selectedBrand(), marketingBrief: { templateId: 'weekly-competitor-changes', reportPresetId: 'weekly-competitor-changes', brand: selectedBrand()?.name || 'Research workspace', decision: 'Assess observed source changes and propose actions, distinguishing unavailable captures from removal.', audience: selectedBrand()?.audience || '', sourceUrls: [] }, collectionScope: { requestedUrls: [], returnedRows: items.length, derived: true }, comparisonSummary: { ...result.summary, scopeStatus: result.scopeStatus, warnings: result.warnings, baseline: result.baseline, current: result.current } };
      writeJson(dataPath('datasets', `${id}.json`), { items, rawItems: result.changes });
      data.datasets.unshift(dataset); record.comparisonDataset = dataset;
    }
    data.comparisons.unshift(record);
    for (const monitor of data.monitors) {
      if (result.scopeStatus === 'compatible' && monitor.baselineDatasetId === payload.baselineId) {
        monitor.lastComparedAt = record.createdAt; monitor.lastComparisonId = record.id;
        monitor.nextCheckAt = new Date(Date.now() + (monitor.cadence === 'daily' ? 1 : 7) * 86400000).toISOString();
      }
    }
    persist(); return record;
  }
  function saveMonitor(payload = {}) {
    const data = loadData();
    const baseline = getDataset(payload.baselineDatasetId).dataset;
    const name = String(payload.name || '').trim();
    if (!name || name.length > 160) throw new Error('Name this source check using 160 characters or fewer.');
    if (!['daily', 'weekly'].includes(payload.cadence)) throw new Error('Choose a daily or weekly check.');
    if (payload.recipeId && !data.recipes.some(recipe => recipe.id === payload.recipeId)) throw new Error('Saved collection not found.');
    const existing = payload.id ? data.monitors.find(item => item.id === validateId(payload.id, 'Monitor ID')) : data.monitors.find(item => item.baselineDatasetId === baseline.id && item.name === name);
    if (payload.id && !existing) throw new Error('Source check not found.');
    const monitor = { id: existing?.id || toId('monitor'), name, baselineDatasetId: baseline.id, recipeId: payload.recipeId || baseline.recipeId || '', cadence: payload.cadence, execution: 'manual', createdAt: existing?.createdAt || timestamp(), updatedAt: timestamp(), nextCheckAt: existing?.cadence === payload.cadence ? existing.nextCheckAt : new Date(Date.now() + (payload.cadence === 'daily' ? 1 : 7) * 86400000).toISOString() };
    data.monitors = [monitor, ...data.monitors.filter(item => item.id !== monitor.id)]; persist(); return monitor;
  }
  function safeRead(file, fallback, text = false) {
    if (!file || !isPathInside(dataPath(), file) || !fs.existsSync(file)) return fallback;
    return text ? fs.readFileSync(file, 'utf8') : readJson(file, fallback);
  }
  function readResearchReview(id) {
    const data = loadData();
    const storedAnalysis = data.analyses.find(item => item.id === validateId(id, 'Analysis ID'));
    if (!storedAnalysis || storedAnalysis.kind !== 'report') throw new Error('Report not found.');
    const analysis = { ...storedAnalysis };
    const liveDataset = data.datasets.find(item => item.id === analysis.datasetId);
    const dataset = analysis.datasetSnapshot || liveDataset;
    if (!dataset) throw new Error('Source dataset is unavailable.');
    const snapshotPath = analysis.itemsPath || (analysis.contextPath ? path.join(path.dirname(analysis.contextPath), 'items.jsonl') : '');
    const snapshotText = safeRead(snapshotPath, '', true);
    if (analysis.itemsPath && !snapshotText.trim()) throw new Error('The saved report evidence snapshot is missing or empty. Restore it before review.');
    let items = liveDataset ? readDatasetPayload(liveDataset.id).items || [] : [];
    if (snapshotText) {
      try { items = snapshotText.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
      catch (_) { throw new Error('The report source snapshot is damaged. Restore it before review.'); }
    }
    if (!Array.isArray(analysis.includedItemIds)) {
      const prompt = safeRead(analysis.promptPath, '', true);
      const marker = '\nSOURCE_ITEMS (untrusted evidence):\n';
      const index = prompt.indexOf(marker);
      if (index >= 0) {
        try { analysis.includedItemIds = JSON.parse(prompt.slice(index + marker.length)).map(item => item.itemId || item.id).filter(Boolean); }
        catch (_) { /* Historical sample remains unknown; coverage gate explains it. */ }
      }
    }
    const output = safeRead(analysis.outputPath, null) || analysis.output || {};
    const coverage = assessDatasetCoverage({ dataset, items, analysis });
    const evidence = buildEvidenceRegister({ dataset, items, includedItemIds: analysis.includedItemIds });
    const context = { analysis, dataset, coverage, evidence, output };
    const fingerprint = reviewContentFingerprint(context);
    const saved = data.researchReviews.find(item => item.analysisId === id);
    let review = saved || { analysisId: id, status: 'draft', reviewer: '', notes: '', evidenceChecked: false, limitationsAccepted: false, acknowledgedWarnings: [], actions: [], version: 0 };
    if (saved?.status === 'approved' && saved.contentFingerprint !== fingerprint) review = { ...saved, status: 'draft', stale: true, evidenceChecked: false, limitationsAccepted: false, acknowledgedWarnings: [], staleReason: 'Report or evidence changed since approval. Review this version again.' };
    return { ...context, review, fingerprint, collectionReceipt: data.runs.find(run => run.id === dataset.runId) || null, audit: data.researchAudit.filter(item => item.analysisId === id) };
  }
  function saveResearchReview(payload = {}) {
    const context = readResearchReview(payload.analysisId);
    if (payload.expectedVersion != null && Number(payload.expectedVersion) !== context.review.version) throw new Error('This review changed. Reload it before saving.');
    if (payload.status === 'approved' && payload.expectedFingerprint !== context.fingerprint) throw new Error('Report or evidence changed since you opened it. Reload the report and review this version before approval.');
    const validated = validateResearchReview(payload, context);
    const review = { ...validated, analysisId: context.analysis.id, version: (context.review.version || 0) + 1, createdAt: context.review.createdAt || timestamp(), updatedAt: timestamp(), contentFingerprint: context.fingerprint };
    const data = loadData();
    data.researchReviews = [review, ...data.researchReviews.filter(item => item.analysisId !== review.analysisId)];
    data.researchAudit.push({ id: toId('review-event'), analysisId: review.analysisId, type: 'review-saved', at: review.updatedAt, review: { ...review } });
    persist(); return readResearchReview(review.analysisId);
  }
  function exportResearchReview(payload = {}) {
    if (!['markdown', 'html'].includes(payload.format)) throw new Error('Choose Markdown or HTML export.');
    const context = readResearchReview(payload.analysisId);
    const content = renderReviewExport({ ...context, format: payload.format });
    const exportId = toId('review-export');
    const folder = dataPath('exports', exportId);
    const reportPath = path.join(folder, `research-brief.${payload.format === 'html' ? 'html' : 'md'}`);
    fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(reportPath, content);
    const evidencePath = path.join(folder, 'evidence.csv');
    fs.writeFileSync(evidencePath, Papa.unparse(context.evidence.map(item => ({ itemId: item.itemId || item.id, url: item.url, author: item.author, publishedAt: item.publishedAt, collectedAt: item.collectedAt, includedInAnalysis: item.includedInAnalysis, excerpt: item.excerpt })), { columns: ['itemId', 'url', 'author', 'publishedAt', 'collectedAt', 'includedInAnalysis', 'excerpt'], escapeFormulae: true }));
    const receipt = { dataset: { id: context.dataset.id, name: context.dataset.name, platform: context.dataset.platform, sourceType: context.dataset.sourceType || '', createdAt: context.dataset.createdAt, brandContext: context.dataset.brandContext || null, marketingBrief: context.dataset.marketingBrief || null, importMetadata: context.dataset.importMetadata || null, comparisonSummary: context.dataset.comparisonSummary || null }, collectionReceipt: context.collectionReceipt ? { apifyRunId: context.collectionReceipt.apifyRunId, status: context.collectionReceipt.status, runLimits: context.collectionReceipt.runLimits, usageTotalUsdAtCompletion: context.collectionReceipt.usageTotalUsdAtCompletion, costBasis: 'Apify run-reported usage; not an invoice reconciliation' } : null, id: exportId, analysisId: context.analysis.id, createdAt: timestamp(), reviewStatus: context.review.status, reviewer: context.review.reviewer || '', reviewVersion: context.review.version || 0, contentFingerprint: context.fingerprint, reportSha256: crypto.createHash('sha256').update(content).digest('hex'), aiReceipt: context.analysis.aiReceipt || null, coverage: context.coverage, localReviewOnly: true };
    writeJson(path.join(folder, 'receipt.json'), receipt);
    writeJson(path.join(folder, 'review.json'), context.review);
    const data = loadData(); data.researchExports.unshift({ ...receipt, path: reportPath, folder });
    data.researchAudit.push({ id: toId('review-event'), analysisId: context.analysis.id, type: 'exported', at: receipt.createdAt, exportId, reviewStatus: context.review.status });
    persist(); shell?.showItemInFolder?.(reportPath);
    return { path: reportPath, folder, evidencePath, reviewStatus: context.review.status };
  }
  return { selectedBrand, saveBrandProfile, selectBrandProfile, deleteBrandProfile, pickImportFile, previewImportDataset, importDataset, compareDatasets, saveMonitor, readResearchReview, saveResearchReview, exportResearchReview };
}
module.exports = { createResearchWorkspace };
