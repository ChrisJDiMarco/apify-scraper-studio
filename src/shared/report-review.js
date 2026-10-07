const { createHash } = require('crypto');
const { safeSourceUrl } = require('./findings-chat');

const REVIEW_STATUSES = ['draft', 'needs-changes', 'approved'];
const ACTION_STATUSES = ['todo', 'in-progress', 'done', 'dismissed'];
const TAXONOMIES = ['observation', 'inference', 'unknown'];
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const count = (value) => Number.isInteger(value) && value >= 0 ? value : null;
const issue = (id, message) => ({ id, message });

function canonicalSourceUrl(value) {
  const safe = safeSourceUrl(typeof value === 'string' ? value : value?.url);
  if (!safe) return '';
  const url = new URL(safe);
  url.hash = '';
  // Query strings, protocol, and trailing slashes may identify different pages.
  return url.href;
}

function knownDate(value) {
  const text = clean(value, 100);
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text.slice(0, 10)).toISOString().slice(0, 10) !== text.slice(0, 10)) return '';
  return new Date(text).toISOString();
}

function collectionDetails(row = {}, dataset = {}) {
  const candidates = [
    [row.collectedAt, 'recorded collection time'],
    [row.provenance?.collectedAt, 'user-supplied import capture time'],
    [dataset.collectedAt, 'recorded collection time'],
    [dataset.importMetadata?.collectedAt, 'user-supplied import capture time'],
    [dataset.collectionScope?.collectedAt, 'recorded collection time'],
    [dataset.createdAt, 'dataset saved time; per-page capture not verified'],
  ];
  const [value, basis] = candidates.find(([value]) => value) || ['', 'collection timestamp unavailable'];
  return { collectedAt: knownDate(value), collectedAtBasis: basis };
}

function includedIds(analysis) {
  const ids = analysis?.includedItemIds ?? analysis?.coverage?.includedItemIds;
  return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && id))] : null;
}

function buildEvidenceRegister({ dataset = {}, items = [], includedItemIds } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const ids = new Map();
  for (const row of rows) if (typeof row?.id === 'string' && row.id && row.id.length <= 1024) ids.set(row.id, (ids.get(row.id) || 0) + 1);
  const included = Array.isArray(includedItemIds) ? new Set(includedItemIds) : null;
  return rows.filter((row) => ids.get(row?.id) === 1).map((row) => ({
    id: row.id,
    itemId: row.id,
    url: safeSourceUrl(row.url),
    canonicalUrl: canonicalSourceUrl(row.url),
    author: clean(row.author, 300),
    platform: clean(row.platform || dataset.platform, 100),
    publishedAt: knownDate(row.publishedAt),
    ...collectionDetails(row, dataset),
    sourceType: clean(row.provenance?.sourceType || dataset.sourceType, 100),
    sourceName: clean(row.provenance?.sourceName || dataset.importMetadata?.sourceName, 240),
    sourceRow: count(row.provenance?.sourceRow),
    resultIndex: count(row.provenance?.resultIndex),
    contentHash: clean(row.provenance?.contentHash || dataset.importMetadata?.contentHash, 512),
    excerpt: clean(row.text, 480),
    text: typeof row.text === 'string' ? row.text : '',
    includedInAnalysis: included ? included.has(row.id) : null,
  }));
}

function assessDatasetCoverage({ dataset = {}, items = [], analysis } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const scope = dataset.collectionScope || {};
  const requestedRaw = scope.requestedUrls ?? dataset.marketingBrief?.sourceUrls ?? dataset.searchContext?.sourceUrls;
  const requestedList = Array.isArray(requestedRaw) ? requestedRaw : [];
  const requestedUrls = [...new Set(requestedList.map(canonicalSourceUrl).filter(Boolean))];
  const requestedScopeKnown = Array.isArray(requestedRaw) && requestedUrls.length > 0;
  const retrievedUrls = [...new Set(rows.map((row) => canonicalSourceUrl(row?.url)).filter(Boolean))];
  const retrieved = new Set(retrievedUrls);
  const missingUrls = requestedUrls.filter((url) => !retrieved.has(url));
  const sampled = includedIds(analysis);
  const evidence = buildEvidenceRegister({ dataset, items: rows, includedItemIds: sampled });
  const textRows = rows.filter((row) => typeof row?.text === 'string' && row.text.trim());
  const idCounts = new Map();
  const signatures = new Set();
  let duplicateRows = 0;
  for (const row of rows) {
    if (typeof row?.id === 'string' && row.id) idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
    const signature = JSON.stringify([canonicalSourceUrl(row?.url), typeof row?.text === 'string' ? row.text.trim() : '', clean(row?.author), clean(row?.publishedAt)]);
    if (signatures.has(signature)) duplicateRows += 1;
    signatures.add(signature);
  }
  const sourceCounts = Object.create(null);
  for (const row of evidence) {
    const source = row.url ? new URL(row.url).hostname : row.platform || 'Imported or unidentified source';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  const usableEvidence = evidence.filter((row) => row.text.trim());
  const usableIncluded = sampled ? usableEvidence.filter((row) => row.includedInAnalysis).length : null;
  const knownIds = new Set(evidence.map((row) => row.id));
  const missingSampleIds = sampled ? sampled.filter((id) => !knownIds.has(id)) : [];
  const dates = evidence.map((row) => row.publishedAt).filter(Boolean).sort();
  const counts = {
    total: rows.length,
    usable: textRows.length,
    textless: rows.length - textRows.length,
    duplicateRows,
    missingIds: rows.filter((row) => typeof row?.id !== 'string' || !row.id || row.id.length > 1024).length,
    ambiguousIds: [...idCounts.values()].filter((value) => value > 1).length,
    unsafeUrls: rows.filter((row) => row?.url && !safeSourceUrl(row.url)).length,
    missingUrls: rows.filter((row) => !row?.url).length,
    uniqueUrls: retrievedUrls.length,
    uniqueDomains: new Set(retrievedUrls.map((url) => new URL(url).hostname)).size,
    included: sampled ? evidence.filter((row) => row.includedInAnalysis).length : null,
    usableIncluded,
    omitted: sampled ? rows.length - evidence.filter((row) => row.includedInAnalysis).length : null,
    truncated: count(analysis?.coverage?.truncatedItems),
    unknownPublicationDates: evidence.length - dates.length,
    importInputRows: count(dataset.importMetadata?.inputRows),
    importSkippedRows: count(dataset.importMetadata?.skippedRows),
    importDuplicateRows: count(dataset.importMetadata?.duplicateRows),
  };
  const blockers = [];
  const warnings = [];
  if (!usableEvidence.length) blockers.push(issue('no-usable-evidence', 'There are no uniquely identified source records with usable text.'));
  if (analysis && analysis.status !== 'succeeded') blockers.push(issue('analysis-not-complete', 'Only a successfully completed report can be approved.'));
  if (analysis && analysis.datasetId !== dataset.id) blockers.push(issue('dataset-mismatch', 'The report and selected dataset do not match.'));
  if (analysis && sampled === null) blockers.push(issue('unknown-analysis-sample', 'This historical report has no recorded source sample. It remains available as a draft; regenerate it to establish reviewable provenance.'));
  if (analysis && sampled && !usableIncluded) blockers.push(issue('no-usable-included-evidence', 'The recorded report sample contains no usable source text.'));
  if (missingSampleIds.length) blockers.push(issue('missing-analysis-records', `${missingSampleIds.length} sampled source IDs are missing or ambiguous in the saved dataset.`));
  if (counts.ambiguousIds) warnings.push(issue('duplicate-source-ids', `${counts.ambiguousIds} source IDs occur more than once and are excluded from the evidence register.`));
  if (!requestedScopeKnown) warnings.push(issue('unknown-request-scope', 'No exact requested page list is recorded. Returned records do not establish complete source or platform coverage.'));
  if (requestedList.some((url) => !canonicalSourceUrl(url))) warnings.push(issue('invalid-requested-urls', 'Some requested URLs could not be compared safely.'));
  if (missingUrls.length) warnings.push(issue('missing-requested-pages', `${missingUrls.length} requested URLs have no matching returned record. This is not proof that those pages were removed.`));
  if (counts.textless) warnings.push(issue('textless-records', `${counts.textless} records contain no text and cannot support text-based findings.`));
  if (duplicateRows) warnings.push(issue('duplicate-records', `${duplicateRows} rows repeat the same URL, text, author and publication value. Counts may overstate distinct observations.`));
  if (counts.missingIds) warnings.push(issue('missing-source-ids', `${counts.missingIds} records lack a usable stable ID and are excluded from the evidence register.`));
  if (counts.unsafeUrls || counts.missingUrls) warnings.push(issue('unlinked-records', `${counts.unsafeUrls + counts.missingUrls} records have no safe public URL. Verify them using their local source record.`));
  if (counts.unknownPublicationDates) warnings.push(issue('unknown-publication-dates', `${counts.unknownPublicationDates} evidence records have no verified ISO publication date. Collection time is not publication time.`));
  if (counts.omitted > 0) warnings.push(issue('outside-analysis-sample', `${counts.omitted} loaded records were outside the recorded analysis sample.`));
  if (counts.truncated > 0) warnings.push(issue('shortened-analysis-text', `${counts.truncated} source texts were shortened for analysis. Read the full source before relying on fine detail.`));
  if (analysis && counts.truncated === null) warnings.push(issue('unknown-truncation', 'The saved analysis does not record whether source text was shortened.'));
  if (scope.truncated === true || (Number.isFinite(scope.totalAvailableItems) && scope.totalAvailableItems > rows.length)) warnings.push(issue('collection-truncated', 'The saved collection metadata explicitly indicates additional source records were not retrieved.'));
  else if (Number.isInteger(scope.retrievalLimit) && scope.retrievalLimit > 0 && (count(scope.providerRows) ?? rows.length) >= scope.retrievalLimit) warnings.push(issue('collection-limit-reached', 'This collection reached its retrieval limit. Additional source records may exist; truncation is not confirmed.'));
  if (counts.importSkippedRows > 0) warnings.push(issue('import-skipped-rows', `${counts.importSkippedRows} imported rows without mapped text were excluded before this dataset was saved.`));
  if (counts.importDuplicateRows > 0) warnings.push(issue('import-duplicate-rows', `${counts.importDuplicateRows} duplicate imported rows were excluded before this dataset was saved.`));
  const { collectedAt, collectedAtBasis } = collectionDetails({}, dataset);
  if (!collectedAt) warnings.push(issue('unknown-collection-date', 'A collection or dataset-save timestamp is not recorded.'));
  const result = { requestedScopeKnown, requestedUrls, retrievedUrls, missingUrls, missingSampleIds, counts, collectedAt, collectedAtBasis, publicationRange: { earliest: dates[0] || '', latest: dates.at(-1) || '' }, sourceCounts, blockers, warnings };
  return { ...result, fingerprint: createHash('sha256').update(JSON.stringify({ result, evidence })).digest('hex') };
}

function reportOutput(output) {
  if (output && typeof output === 'object' && output.output && typeof output.output === 'object') return { ...output.output, markdownReport: output.markdown || output.output.markdownReport || '' };
  if (output && typeof output === 'object') return { ...output, markdownReport: output.markdownReport || output.markdown || '' };
  return {};
}

function reviewContentFingerprint({ analysis = {}, coverage = {}, evidence = [], output } = {}) {
  return createHash('sha256').update(JSON.stringify({ analysisId: analysis.id, datasetId: analysis.datasetId, status: analysis.status, finishedAt: analysis.finishedAt, coverageFingerprint: coverage.fingerprint, evidence: evidence.map((row) => ({ id: row.itemId || row.id, text: row.text, url: row.url, included: row.includedInAnalysis })), output: reportOutput(output) })).digest('hex');
}

function field(value, name, max, required = false) {
  if (value != null && typeof value !== 'string') throw new Error(`${name} must be text.`);
  const text = (value || '').trim();
  if (text.length > max) throw new Error(`${name} is too long.`);
  if (required && !text) throw new Error(`${name} is required.`);
  return text;
}

function validateResearchReview(input = {}, context = {}) {
  const { analysis = {}, coverage = {}, evidence = [], output } = context;
  const status = input.status || 'draft';
  if (!REVIEW_STATUSES.includes(status)) throw new Error('Choose Draft, Needs changes, or Approved.');
  if (input.analysisId !== analysis.id) throw new Error('The review does not match this report.');
  const reviewer = field(input.reviewer, 'Reviewer name', 160, status === 'approved');
  const notes = field(input.notes, 'Review notes', 6000);
  const evidenceChecked = input.evidenceChecked === true;
  const limitationsAccepted = input.limitationsAccepted === true;
  if (input.acknowledgedWarnings != null && !Array.isArray(input.acknowledgedWarnings)) throw new Error('Warning acknowledgements must be a list.');
  const validWarnings = new Set((coverage.warnings || []).map((warning) => warning.id));
  const acknowledgedWarnings = [...new Set((input.acknowledgedWarnings || []).map((id) => field(id, 'Warning ID', 100)))];
  if (acknowledgedWarnings.some((id) => !validWarnings.has(id))) throw new Error('The coverage changed. Refresh and review its current limitations.');
  if (input.actions != null && (!Array.isArray(input.actions) || input.actions.length > 30)) throw new Error('Keep the action list to 30 items or fewer.');
  const evidenceIds = new Set(evidence.map((row) => row.itemId || row.id));
  const actionIds = new Set();
  const actions = (input.actions || []).map((action) => {
    if (!action || typeof action !== 'object') throw new Error('Every action must be an object.');
    const id = field(action.id, 'Action ID', 180, true);
    if (!/^[a-z0-9._-]+$/i.test(id) || actionIds.has(id)) throw new Error('Action IDs must be unique safe identifiers.');
    actionIds.add(id);
    const title = field(action.title, 'Action title', 500, true);
    const owner = field(action.owner, 'Action owner', 160);
    const dueDate = field(action.dueDate, 'Due date', 10);
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) throw new Error('Use a valid YYYY-MM-DD action due date.');
    const actionStatus = action.status || 'todo';
    const taxonomy = action.taxonomy || 'inference';
    if (!ACTION_STATUSES.includes(actionStatus) || !TAXONOMIES.includes(taxonomy)) throw new Error('The action status or evidence classification is invalid.');
    if (action.evidenceIds != null && (!Array.isArray(action.evidenceIds) || action.evidenceIds.length > 40)) throw new Error('An action can reference up to 40 evidence records.');
    const linked = [...new Set((action.evidenceIds || []).map((entry) => field(entry, 'Evidence ID', 1024, true)))];
    if (linked.some((id) => !evidenceIds.has(id))) throw new Error('An action references evidence outside this report dataset.');
    if (status === 'approved' && actionStatus !== 'dismissed' && !owner) throw new Error('Assign an owner to every active action before approval.');
    if (status === 'approved' && taxonomy === 'observation' && !linked.length) throw new Error('Observation actions need at least one source reference.');
    return { id, title, owner, dueDate, status: actionStatus, taxonomy, evidenceIds: linked };
  });
  if (status === 'approved') {
    if (analysis.kind !== 'report' || analysis.status !== 'succeeded') throw new Error('Only a successfully completed report can be approved.');
    if ((coverage.blockers || []).length) throw new Error(`Approval blocked: ${coverage.blockers[0].message}`);
    if (!(coverage.counts?.usableIncluded > 0)) throw new Error('Approval requires usable evidence from the recorded analysis sample.');
    const report = reportOutput(output);
    if (!clean(report.markdownReport, 500000) && !clean(report.summary, 20000)) throw new Error('The saved report output is unavailable.');
    if (!evidenceChecked || !limitationsAccepted) throw new Error('Complete both review checks before approval.');
    if ([...validWarnings].some((id) => !acknowledgedWarnings.includes(id))) throw new Error('Acknowledge every coverage limitation before approval.');
  }
  return { analysisId: analysis.id, status, reviewer, reviewerBasis: 'self-reported local reviewer; not authenticated team approval', notes, evidenceChecked, limitationsAccepted, acknowledgedWarnings, actions, contentFingerprint: reviewContentFingerprint(context) };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const markdownText = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
// A variable-length fence preserves complete untrusted report text without creating
// remote images, executable links, or a counterfeit export status in a Markdown reader.
const markdownLiteral = (value) => { const text = String(value ?? ''); const fence = '`'.repeat([...text.matchAll(/`+/g)].reduce((size, match) => Math.max(size, match[0].length + 1), 3)); return `${fence}text\n${text}\n${fence}`; };

function renderReviewExport({ analysis = {}, dataset = {}, coverage = {}, evidence = [], review = {}, output, format = 'markdown' } = {}) {
  if (!['markdown', 'html'].includes(format)) throw new Error('Choose Markdown or HTML export.');
  const context = { analysis, coverage, evidence, output };
  if (review.status === 'approved' && review.contentFingerprint !== reviewContentFingerprint(context)) throw new Error('The report or evidence changed after approval. Review it again before exporting as approved.');
  const checked = validateResearchReview({ ...review, analysisId: analysis.id, status: review.status || 'draft' }, context);
  const report = reportOutput(output);
  const title = clean(report.title || analysis.reportPresetName || dataset.name || 'Research report', 300);
  const status = checked.status === 'approved' ? 'APPROVED — LOCAL REVIEW' : checked.status === 'needs-changes' ? 'DRAFT — NEEDS CHANGES' : 'DRAFT — NOT APPROVED';
  const limitations = [...(coverage.blockers || []), ...(coverage.warnings || [])];
  const reportText = report.markdownReport || report.summary || 'No saved report output is available.';
  const included = coverage.counts?.included == null ? 'unknown' : coverage.counts.included;
  if (format === 'markdown') return `# ${markdownText(title)}\n\n> **${status}**\n> Reviewer: ${markdownText(checked.reviewer || 'Unassigned')} (self-reported locally). This is not authenticated team approval.\n\n## Coverage\n\n${coverage.counts?.total ?? 0} loaded records; ${included} included in the recorded sample. Saved/collected: ${coverage.collectedAt || 'Unknown'}.\n\n${limitations.map((entry) => `- ${markdownText(entry.message)}`).join('\n') || 'No automatic coverage issues detected; this does not verify every claim.'}\n\n## Review notes\n\n${markdownText(checked.notes || 'No notes recorded.')}\n\n## Report\n\n${markdownLiteral(reportText)}\n\n## Actions\n\n${checked.actions.map((action) => `- **${markdownText(action.title)}** — ${action.status}; ${action.taxonomy}; owner: ${markdownText(action.owner || 'Unassigned')}; due: ${action.dueDate || 'Not set'}\n  Evidence: ${action.evidenceIds.map(markdownText).join(', ') || 'Not linked'}`).join('\n') || 'No actions recorded.'}\n\n## Evidence register\n\n${evidence.map((row) => `### ${markdownText(row.itemId || row.id)}\n\n- Source: ${markdownText(safeSourceUrl(row.url) || 'Local record; no safe public URL')}\n- Author: ${markdownText(row.author || 'Unknown')}\n- Published: ${row.publishedAt || 'Unknown'}; collected/saved: ${row.collectedAt || 'Unknown'}\n- Included in analysis: ${row.includedInAnalysis === null ? 'Unknown' : row.includedInAnalysis ? 'Yes' : 'No'}\n\n${markdownText(row.excerpt || 'No text excerpt.')}\n`).join('\n')}\n`;
  const bullets = (values) => `<ul>${(Array.isArray(values) ? values : []).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#203027;max-width:1000px;margin:45px auto;padding:0 28px}h1{font-size:32px;line-height:1.2}h2{margin-top:32px}.status{padding:14px;background:#f0f3df;border:1px solid #d8dfbd;font-weight:700}small{color:#657468}article{border:1px solid #dce4da;border-radius:8px;padding:16px;margin:12px 0}a{color:#286347;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #e0e6dc;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}.status{border:2px solid #555}article{break-inside:avoid}}</style></head><body><div class="status">${escapeHtml(status)}</div><h1>${escapeHtml(title)}</h1><p>Reviewer: ${escapeHtml(checked.reviewer || 'Unassigned')} <small>(self-reported locally; not authenticated team approval)</small></p><h2>Coverage</h2><p>${coverage.counts?.total ?? 0} loaded records; ${escapeHtml(included)} included in the recorded sample. Collected/saved: ${escapeHtml(coverage.collectedAt || 'Unknown')}.</p>${bullets(limitations.map((entry) => entry.message))}<h2>Review notes</h2><p>${escapeHtml(checked.notes || 'No notes recorded.')}</p><h2>Summary</h2><p>${escapeHtml(report.summary || '')}</p>${bullets(report.bullets)}<h2>Actions</h2><table><thead><tr><th>Action / classification</th><th>Owner / due</th><th>Status / evidence</th></tr></thead><tbody>${checked.actions.map((action) => `<tr><td>${escapeHtml(action.title)}<br><small>${escapeHtml(action.taxonomy)}</small></td><td>${escapeHtml(action.owner || 'Unassigned')}<br>${escapeHtml(action.dueDate || 'Not set')}</td><td>${escapeHtml(action.status)}<br><small>${escapeHtml(action.evidenceIds.join(', '))}</small></td></tr>`).join('')}</tbody></table><h2>Evidence register</h2>${evidence.map((row) => `<article><strong>${escapeHtml(row.itemId || row.id)}</strong><br>${safeSourceUrl(row.url) ? `<a href="${escapeHtml(safeSourceUrl(row.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.url)}</a>` : 'Local record; no safe public URL'}<p>${escapeHtml(row.excerpt || 'No text excerpt.')}</p><small>Author: ${escapeHtml(row.author || 'Unknown')} · Published: ${escapeHtml(row.publishedAt || 'Unknown')} · Collected/saved: ${escapeHtml(row.collectedAt || 'Unknown')} · Included: ${row.includedInAnalysis === null ? 'Unknown' : row.includedInAnalysis ? 'Yes' : 'No'}</small></article>`).join('')}<h2>Complete report text</h2><pre>${escapeHtml(reportText)}</pre></body></html>`;
}

module.exports = { assessDatasetCoverage, buildEvidenceRegister, validateResearchReview, renderReviewExport, reviewContentFingerprint, canonicalSourceUrl, REVIEW_STATUSES, ACTION_STATUSES, TAXONOMIES };
