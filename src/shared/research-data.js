const Papa = require('papaparse');
const { createHash } = require('node:crypto');
const { redactSecrets } = require('./recipe');

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const IMPORT_SOURCE_TYPES = ['customer-feedback', 'serp', 'ad-library', 'general'];
const MAPPING_FIELDS = ['text', 'url', 'date', 'author', 'account', 'query', 'rank'];
const ALIASES = {
  text: ['text', 'body', 'content', 'feedback', 'comment', 'review', 'description', 'snippet', 'title'],
  url: ['url', 'link', 'sourceUrl', 'landingPageUrl', 'adUrl', 'permalink'],
  date: ['publishedAt', 'date', 'createdAt', 'timestamp', 'postedAtISO'],
  author: ['authorName', 'author.name', 'author', 'reviewer', 'username'],
  account: ['account', 'company', 'companyName', 'advertiser', 'brand'],
  query: ['query', 'searchQuery.term', 'searchQuery', 'keyword', 'searchTerm'],
  rank: ['rank', 'position', 'organicPosition'],
};
const cleanText = (value) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const semanticText = (value) => cleanText(value).normalize('NFC').replace(/\s+/gu, ' ');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function safeUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function canonicalUrl(value) {
  const valid = safeUrl(value);
  if (!valid) return '';
  const url = new URL(valid);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|igshid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function valueAt(row, field) {
  if (!field || typeof field !== 'string') return undefined;
  if (Object.hasOwn(row, field)) return row[field];
  return field.split('.').reduce((value, key) => value && typeof value === 'object' && !['__proto__', 'constructor', 'prototype'].includes(key) && Object.hasOwn(value, key) ? value[key] : undefined, row);
}

function columnsFor(rows) {
  const names = new Set();
  function visit(value, prefix = '', depth = 0) {
    for (const [key, entry] of Object.entries(value || {})) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && depth < 3) visit(entry, name, depth + 1);
      else if (names.size < 200) names.add(name);
    }
  }
  rows.forEach((row) => visit(row));
  return [...names];
}

function parseRows(content, format) {
  if (format === 'csv') {
    const parsed = Papa.parse(content.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', dynamicTyping: false });
    const error = parsed.errors.find((entry) => entry.code !== 'UndetectableDelimiter');
    if (error) throw new Error(`CSV could not be read: ${error.message}`);
    const [header = [], ...rows] = parsed.data;
    if (!header.length || !rows.length) throw new Error('CSV needs a header row and at least one data row.');
    const columns = header.map((value, index) => cleanText(value) || `column_${index + 1}`);
    if (new Set(columns).size !== columns.length) throw new Error('CSV column names must be unique. Rename duplicate headers and try again.');
    return rows.map((values, index) => {
      if (values.length !== columns.length) throw new Error(`CSV row ${index + 2} has ${values.length} cells; its header has ${columns.length}. Check commas and quotation marks.`);
      return Object.fromEntries(columns.map((key, column) => [key, values[column]]));
    });
  }
  if (format === 'jsonl') {
    return content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`JSONL record ${index + 1} is not valid JSON.`); }
    });
  }
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('The pasted content is not valid JSON.'); }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const key of ['items', 'data', 'results']) if (Array.isArray(parsed[key]) && !parsed.organicResults) return parsed[key];
    return [parsed];
  }
  throw new Error('JSON must contain records as an object, an array, or an items/data/results array.');
}

function flattenRows(rows, sourceType) {
  const flattened = [];
  rows.forEach((row, sourceIndex) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Record ${sourceIndex + 1} must be an object with named fields.`);
    if (sourceType === 'serp' && Array.isArray(row.organicResults)) {
      const query = cleanText(row.query) || cleanText(row.searchQuery?.term) || cleanText(row.searchQuery) || cleanText(row.keyword);
      if (flattened.length + row.organicResults.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS.toLocaleString()} records, including nested search results.`);
      row.organicResults.forEach((result, index) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`Search record ${sourceIndex + 1} contains an invalid organic result.`);
        flattened.push({ row: {
          ...result,
          text: cleanText(result.text) || [cleanText(result.title), cleanText(result.description || result.snippet)].filter(Boolean).join('\n'),
          query: cleanText(result.query) || query,
          rank: result.rank ?? result.position ?? null,
          country: cleanText(result.country) || cleanText(row.country || row.countryCode || row.searchQuery?.countryCode),
          language: cleanText(result.language) || cleanText(row.language || row.languageCode || row.searchQuery?.languageCode),
        }, sourceRow: sourceIndex + 1, resultIndex: index + 1 });
      });
    } else flattened.push({ row, sourceRow: sourceIndex + 1 });
    if (flattened.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS.toLocaleString()} records, including nested search results.`);
  });
  return flattened;
}

function prepareImport(payload = {}) {
  const { content, mapping = {}, metadata = {}, brandContext = {} } = payload;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Choose a file or paste some records first.');
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw new Error('Import files must be 5 MB or smaller. Split the export and try again.');
  if (!payload.preview && payload.authorized !== true) throw new Error('Confirm that you are authorized to use this data before importing.');
  const format = String(payload.format || 'csv').toLowerCase();
  if (!['csv', 'json', 'jsonl'].includes(format)) throw new Error('Choose CSV, JSON, or JSONL.');
  const sourceType = payload.sourceType || 'general';
  if (!IMPORT_SOURCE_TYPES.includes(sourceType)) throw new Error('Choose a supported source type.');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Column mapping must be an object.');
  const name = cleanText(payload.name) || 'Imported research';
  if (name.length > 160) throw new Error('Keep the collection name to 160 characters or fewer.');
  const parsed = parseRows(content, format);
  if (!parsed.length) throw new Error('No records were found.');
  if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS.toLocaleString()} records.`);
  const flattened = flattenRows(parsed, sourceType);
  if (!flattened.length) throw new Error('No organic search results were found in this export.');
  const columns = columnsFor(flattened.map(({ row }) => row));
  const effectiveMapping = Object.fromEntries(MAPPING_FIELDS.map((field) => {
    const selected = Object.hasOwn(mapping, field) ? mapping[field] : ALIASES[field].map((alias) => columns.find((key) => key.replace(/[ _-]/g, '').toLowerCase() === alias.replace(/[ _-]/g, '').toLowerCase())).find(Boolean) || '';
    if (typeof selected !== 'string' || (selected && !columns.includes(selected))) throw new Error(`Choose an existing column for ${field}.`);
    return [field, selected];
  }));
  if (!effectiveMapping.text) {
    if (!payload.preview) throw new Error('Map a text column so your records can be analyzed.');
    return { dataset: { name, platform: 'import', sourceType, importMetadata: {} }, items: [], rawItems: [], summary: { ready: false, inputRows: flattened.length, importedRows: 0, duplicateRows: 0, skippedRows: 0, columns, mapping: effectiveMapping, preview: [], warnings: ['Choose a text column below, then preview the mapped records.'] } };
  }
  const collectedAt = cleanText(metadata.collectedAt);
  if (collectedAt && (!/^\d{4}-\d{2}-\d{2}/.test(collectedAt) || !Number.isFinite(Date.parse(collectedAt)))) throw new Error('Use a valid collection date, such as 2026-09-27.');
  const sourceName = cleanText(metadata.sourceName).slice(0, 160) || name;
  const country = cleanText(metadata.country).slice(0, 100);
  const language = cleanText(metadata.language).slice(0, 100);
  const contentHash = digest(content);
  const items = [];
  const rawItems = [];
  const seen = new Set();
  let duplicateRows = 0;
  let skippedRows = 0;
  let unsafeUrls = 0;
  let invalidRanks = 0;
  for (const { row, sourceRow, resultIndex } of flattened) {
    const text = cleanText(valueAt(row, effectiveMapping.text));
    if (!text) { skippedRows += 1; continue; }
    const originalUrl = cleanText(valueAt(row, effectiveMapping.url));
    const url = safeUrl(originalUrl);
    if (originalUrl && !url) unsafeUrls += 1;
    const publishedAt = cleanText(valueAt(row, effectiveMapping.date));
    const author = cleanText(valueAt(row, effectiveMapping.author));
    const account = cleanText(valueAt(row, effectiveMapping.account));
    const query = cleanText(valueAt(row, effectiveMapping.query));
    const rankValue = cleanText(valueAt(row, effectiveMapping.rank));
    const rank = /^\d+$/.test(rankValue) && Number(rankValue) > 0 && Number.isSafeInteger(Number(rankValue)) ? Number(rankValue) : null;
    if (rankValue && rank === null) invalidRanks += 1;
    const rowCountry = cleanText(row.country || row.countryCode) || country;
    const rowLanguage = cleanText(row.language || row.languageCode) || language;
    const externalId = cleanText(row.id ?? row.externalId ?? row.adId ?? row.reviewId);
    const key = JSON.stringify([externalId || canonicalUrl(url) || [author, publishedAt], account, query, rowCountry, rowLanguage, semanticText(text)]);
    if (seen.has(key)) { duplicateRows += 1; continue; }
    seen.add(key);
    const raw = redactSecrets(row);
    items.push({
      id: `import-${contentHash.slice(0, 16)}:${digest(key).slice(0, 20)}`,
      externalId, type: sourceType === 'serp' ? 'search-result' : sourceType === 'ad-library' ? 'ad' : sourceType === 'customer-feedback' ? 'feedback' : 'record',
      platform: 'import', sourceType, text, url, publishedAt, author, account, query, rank,
      country: rowCountry, language: rowLanguage, parentId: '', threadId: '', metrics: {}, raw,
      provenance: { sourceType, sourceName, format, sourceRow, ...(resultIndex ? { resultIndex } : {}), contentHash, collectedAt, query, rank, country: rowCountry, language: rowLanguage },
    });
    rawItems.push(raw);
  }
  if (!items.length) throw new Error('No usable text remains. Check your text-column mapping.');
  const warnings = [];
  if (duplicateRows) warnings.push(`${duplicateRows} exact duplicate record${duplicateRows === 1 ? '' : 's'} excluded.`);
  if (skippedRows) warnings.push(`${skippedRows} record${skippedRows === 1 ? '' : 's'} without mapped text excluded.`);
  if (unsafeUrls) warnings.push(`${unsafeUrls} unsupported or credential-bearing source link${unsafeUrls === 1 ? '' : 's'} omitted. Text is still included.`);
  if (invalidRanks) warnings.push(`${invalidRanks} invalid rank value${invalidRanks === 1 ? '' : 's'} left blank.`);
  if (sourceType === 'serp' && items.some((item) => item.rank == null)) warnings.push(`${items.filter((item) => item.rank == null).length} search results have no recorded rank. Import order is not a search ranking.`);
  if (sourceType === 'serp' && !items.some((item) => item.query)) warnings.push('No search query was supplied. Map the query column before comparing search coverage.');
  const templateId = cleanText(payload.templateId);
  const reportPresetId = cleanText(payload.reportPresetId) || templateId;
  const importMetadata = { format, sourceName, contentHash, collectedAt, country, language, mapping: effectiveMapping, authorized: payload.authorized === true, inputRows: flattened.length, duplicateRows, skippedRows };
  return {
    dataset: {
      name, platform: 'import', sourceType, itemCount: items.length, importMetadata,
      ...(templateId || reportPresetId || cleanText(brandContext.brand) ? { marketingBrief: { templateId, reportPresetId, brand: cleanText(brandContext.brand).slice(0, 120), decision: cleanText(brandContext.decision).slice(0, 2000), audience: cleanText(brandContext.audience).slice(0, 300) } } : {}),
    },
    items, rawItems,
    summary: { ready: true, inputRows: flattened.length, importedRows: items.length, duplicateRows, skippedRows, warnings, columns, mapping: effectiveMapping, preview: items.slice(0, 20).map(({ raw, ...item }) => item) },
  };
}

function datasetReference(snapshot) {
  if (!snapshot?.dataset) return null;
  const dataset = snapshot.dataset;
  return { id: dataset.id || '', name: dataset.name || 'Snapshot', createdAt: dataset.createdAt || '', itemCount: (snapshot.items || []).length, recipeId: dataset.recipeId || '' };
}

function collectedAt(item, dataset) {
  return cleanText(item?.collectedAt || item?.provenance?.collectedAt || dataset?.collectedAt || dataset?.importMetadata?.collectedAt || dataset?.createdAt);
}

function comparisonExcerpts(before, after, changed) {
  let difference = 0;
  if (changed) while (difference < Math.min(before.length, after.length) && before[difference] === after[difference]) difference += 1;
  const start = changed ? Math.max(0, difference - 220) : 0;
  const excerpt = (text) => `${start > 0 ? '…' : ''}${text.slice(start, start + 1600)}${text.length > start + 1600 ? '…' : ''}`;
  return { beforeExcerpt: before ? excerpt(before) : '', afterExcerpt: after ? excerpt(after) : '' };
}

function compareSnapshots({ baseline, current } = {}) {
  if (!current?.dataset || !Array.isArray(current.items)) throw new Error('Choose a current snapshot.');
  if (baseline && (!baseline.dataset || !Array.isArray(baseline.items))) throw new Error('Choose a valid baseline snapshot.');
  if (baseline?.dataset.id && baseline.dataset.id === current.dataset.id) throw new Error('Choose two different snapshots.');
  const result = { baseline: datasetReference(baseline), current: datasetReference(current), summary: { baselineEstablished: !baseline, changed: 0, unchanged: 0, new: 0, unavailable: 0, compared: 0 }, changes: [], warnings: [], scopeStatus: 'compatible' };
  if (!baseline) {
    result.warnings.push('This is the first snapshot. It establishes a baseline; no change has been measured.');
    return result;
  }
  const beforeType = baseline.dataset.sourceType || baseline.dataset.platform;
  const afterType = current.dataset.sourceType || current.dataset.platform;
  if (beforeType && afterType && beforeType !== afterType) {
    result.scopeStatus = 'incompatible';
    result.warnings.push('These snapshots have different source types. Choose matching sources before interpreting changes.');
    return result;
  }
  if (baseline.dataset.recipeId && current.dataset.recipeId && baseline.dataset.recipeId !== current.dataset.recipeId) {
    result.scopeStatus = 'needs-review';
    result.warnings.push('These snapshots use different collection recipes. Confirm their source scope before interpreting changes.');
  }
  const beforeScope = baseline.dataset.searchContext?.query || baseline.dataset.importMetadata?.sourceName;
  const afterScope = current.dataset.searchContext?.query || current.dataset.importMetadata?.sourceName;
  if (beforeScope && afterScope && beforeScope !== afterScope) {
    result.scopeStatus = 'needs-review';
    result.warnings.push('The recorded query or import source differs. Changes may reflect a different collection scope.');
  }
  function index(snapshot) {
    const entries = new Map();
    let noUrl = 0;
    let ambiguous = 0;
    for (const item of snapshot.items) {
      const url = canonicalUrl(item?.url);
      if (!url) { noUrl += 1; continue; }
      const existing = entries.get(url);
      if (existing && semanticText(existing.item.text) !== semanticText(item.text)) {
        if (!existing.ambiguous) ambiguous += 1;
        entries.set(url, { ...existing, ambiguous: true });
      } else if (!existing) entries.set(url, { item, ambiguous: false });
    }
    if (noUrl) result.warnings.push(`${snapshot.dataset.name || 'Snapshot'}: ${noUrl} record${noUrl === 1 ? '' : 's'} without a usable URL excluded from matching.`);
    if (ambiguous) result.warnings.push(`${snapshot.dataset.name || 'Snapshot'}: ${ambiguous} URL${ambiguous === 1 ? ' has' : 's have'} conflicting records; these comparisons are unavailable.`);
    return entries;
  }
  const before = index(baseline);
  const after = index(current);
  if (!before.size || !after.size) result.warnings.push('One snapshot has no usable URL records. Unavailable does not mean a page was removed.');
  if (before.size && after.size && ![...before.keys()].some((url) => after.has(url))) {
    result.scopeStatus = 'needs-review';
    result.warnings.push('No source URLs match across these snapshots. Check collection scope; missing pages are not confirmed removals.');
  }
  for (const url of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(url);
    const next = after.get(url);
    const beforeText = semanticText(previous?.item.text);
    const afterText = semanticText(next?.item.text);
    const status = !next || !afterText || previous?.ambiguous || next?.ambiguous || (previous && !beforeText) ? 'unavailable' : !previous ? 'new' : beforeText === afterText ? 'unchanged' : 'changed';
    result.summary[status] += 1;
    result.changes.push({ url, status, ...comparisonExcerpts(beforeText, afterText, status === 'changed'), beforeCollectedAt: previous ? collectedAt(previous.item, baseline.dataset) : '', afterCollectedAt: next ? collectedAt(next.item, current.dataset) : '', ...(previous?.ambiguous || next?.ambiguous ? { reason: 'Conflicting records for this URL.' } : status === 'unavailable' ? { reason: 'The page is missing usable text in one snapshot. This is not evidence of removal.' } : {}) });
  }
  result.summary.compared = result.summary.changed + result.summary.unchanged;
  if (result.summary.unavailable) result.warnings.push('Unavailable means the capture is missing or unusable. It does not establish that a page was removed.');
  const order = { changed: 0, new: 1, unavailable: 2, unchanged: 3 };
  result.changes.sort((a, b) => order[a.status] - order[b.status] || a.url.localeCompare(b.url));
  return result;
}

module.exports = { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, IMPORT_SOURCE_TYPES, prepareImport, compareSnapshots, canonicalUrl };
