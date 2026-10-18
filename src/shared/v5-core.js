// The retired v5 event log (v5/events.jsonl) and the dataset evidence tools that outlived it. Workflows replaced the
// v5 missions, action graphs, schedules and evals (src/main/workflow-engine.js); what stays is what other pages use:
// the event helpers and the recipe-version projection (Scrapers' saved versions), and the dataset profile and evidence
// index (Datasets, Test recipe and evidence search). Old mission, job and schedule events stay in the file, unread.
const fs = require('fs');
const path = require('path');

const EVENT_VERSION = 1;

function nowIso(now = () => new Date().toISOString()) {
  const value = typeof now === 'function' ? now() : now;
  return new Date(value).toISOString();
}

function slug(value, fallback = 'item') {
  const text = String(value || fallback).toLowerCase().trim()
    .replace(/[^a-z0-9._~@-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return cleanText(value).toLowerCase();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createEvent(type, payload = {}, options = {}) {
  const timestamp = nowIso(options.now);
  return {
    id: options.id || `event-${slug(type)}-${Date.parse(timestamp)}-${Math.random().toString(36).slice(2, 8)}`,
    version: EVENT_VERSION,
    type,
    payload,
    createdAt: timestamp,
    meta: {
      source: options.source || 'local-v5',
      ...(options.meta || {}),
    },
  };
}

function appendEvent(filePath, event) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
  return event;
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Each scraper's saved versions, newest first. A legacy import (a pre-v5 data.json) seeded version 1 of every recipe it
// had; later saves add theirs. Every other kind of event is ignored.
function projectEvents(events = [], options = {}) {
  const state = { version: 5, projectedAt: nowIso(options.now), recipeVersions: {} };
  for (const event of list(events)) {
    const payload = event?.payload || {};
    if (!event || (event.version && event.version > EVENT_VERSION)) continue;
    if (event.type === 'legacy-imported') {
      for (const recipe of list(payload.data?.recipes)) {
        state.recipeVersions[recipe.id] = [{ version: 1, recipeId: recipe.id, name: recipe.name || recipe.id, input: recipe.input || {}, mapper: recipe.mapper || {}, actorId: recipe.actorId || '', taskId: recipe.taskId || '', platform: recipe.platform || '', createdAt: event.createdAt }];
      }
    }
    if (event.type === 'recipe-version-saved') {
      const recipeId = payload.recipeId || payload.version?.recipeId;
      const current = state.recipeVersions[recipeId] || [];
      state.recipeVersions[recipeId] = [{ recipeId, createdAt: event.createdAt, ...(payload.version || {}) }, ...current].sort((a, b) => numeric(b.version) - numeric(a.version));
    }
  }
  return state;
}

function fieldSet(items) {
  const fields = new Map();
  for (const item of list(items)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) {
      const value = item[key];
      const current = fields.get(key) || { name: key, present: 0, types: new Set(), examples: [] };
      if (value !== undefined && value !== null && value !== '') {
        current.present += 1;
        current.types.add(Array.isArray(value) ? 'array' : typeof value);
        if (current.examples.length < 3) current.examples.push(value);
      }
      fields.set(key, current);
    }
  }
  return Array.from(fields.values()).map((field) => ({
    name: field.name,
    coverage: list(items).length ? Number((field.present / list(items).length).toFixed(2)) : 0,
    types: Array.from(field.types).sort(),
    examples: field.examples,
  })).sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name));
}

function itemText(item) {
  return cleanText(item?.text || item?.title || item?.body || item?.description || item?.content || item?.name || '');
}

function itemUrl(item) {
  return cleanText(item?.url || item?.href || item?.link || item?.permalink || item?.postUrl || item?.website || '');
}

function itemPublishedAt(item) {
  return cleanText(item?.publishedAt || item?.createdAt || item?.date || item?.timestamp || '');
}

function buildDatasetProfileV2(dataset = {}, payload = {}, options = {}) {
  const items = list(payload.items);
  const keys = new Set();
  const rowTypes = new Map();
  const dates = [];
  let textCount = 0;
  let urlCount = 0;
  for (const item of items) {
    const key = item?.id || `${itemText(item)}|${itemUrl(item)}`;
    if (key) keys.add(key);
    rowTypes.set(item?.type || 'row', (rowTypes.get(item?.type || 'row') || 0) + 1);
    if (itemText(item)) textCount += 1;
    if (itemUrl(item)) urlCount += 1;
    const date = Date.parse(itemPublishedAt(item));
    if (Number.isFinite(date)) dates.push(date);
  }
  const rowCount = items.length;
  const duplicateCount = Math.max(0, rowCount - keys.size);
  const textCoverage = rowCount ? textCount / rowCount : 0;
  const urlCoverage = rowCount ? urlCount / rowCount : 0;
  const mapperWarnings = [];
  const qualityWarnings = [];
  if (rowCount && textCoverage < 0.4) mapperWarnings.push('Map a readable text/title/body field before running analyst reports.');
  if (rowCount && urlCoverage < 0.25) mapperWarnings.push('Map source URL/permalink fields so evidence can be inspected.');
  if (duplicateCount > 0) qualityWarnings.push(`${duplicateCount} duplicate row${duplicateCount === 1 ? '' : 's'} detected.`);
  const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : '';
  const oldest = dates.length ? new Date(Math.min(...dates)).toISOString() : '';
  const now = Date.parse(nowIso(options.now));
  const ageHours = newest ? Math.round((now - Date.parse(newest)) / 36e5) : null;
  const confidence = Number(clamp(0.25 + textCoverage * 0.34 + urlCoverage * 0.22 + Math.min(rowCount, 100) / 500 - Math.min(duplicateCount, 20) / 100, 0, 0.98).toFixed(2));
  return {
    datasetId: dataset.id || '',
    name: dataset.name || 'Dataset',
    platform: dataset.platform || '',
    rowCount,
    fields: fieldSet(items),
    rowTypes: Array.from(rowTypes.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    textCoverage: Number(textCoverage.toFixed(2)),
    urlCoverage: Number(urlCoverage.toFixed(2)),
    duplicateCount,
    freshness: { newest, oldest, ageHours },
    mapperWarnings,
    qualityWarnings,
    confidence,
    recommendedFixes: [
      ...mapperWarnings.map((warning) => ({ severity: 'high', message: warning })),
      ...qualityWarnings.map((warning) => ({ severity: 'medium', message: warning })),
    ],
  };
}

function evidenceId(datasetId, item, index) {
  return `evidence-${slug(datasetId)}-${slug(item?.id || item?.externalId || index)}`;
}

function buildEvidenceIndex(dataset = {}, payload = {}) {
  return list(payload.items).map((item, index) => {
    const text = itemText(item);
    const sourceUrl = itemUrl(item);
    const confidence = Number(clamp(0.35 + (text ? 0.28 : 0) + (sourceUrl ? 0.24 : 0) + (item?.id ? 0.1 : 0), 0.1, 0.98).toFixed(2));
    return {
      id: evidenceId(dataset.id || 'dataset', item, index),
      datasetId: dataset.id || '',
      runId: dataset.runId || item?.runId || '',
      recipeId: dataset.recipeId || '',
      itemId: item?.id || item?.externalId || `${index}`,
      type: item?.type || 'row',
      text,
      author: item?.author || '',
      sourceUrl,
      publishedAt: itemPublishedAt(item),
      metrics: item?.metrics || {},
      confidence,
      provenance: {
        datasetName: dataset.name || '',
        platform: dataset.platform || item?.platform || '',
        rowIndex: index,
      },
    };
  });
}

function searchEvidence(evidence = [], query = '', options = {}) {
  const q = lower(query);
  if (!q) return list(evidence).slice(0, options.limit || 20);
  return list(evidence)
    .map((item) => {
      const haystack = lower(`${item.text} ${item.author} ${item.sourceUrl} ${item.type}`);
      const score = haystack.includes(q) ? 10 : q.split(/\s+/).reduce((sum, part) => sum + (part && haystack.includes(part) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.confidence - a.item.confidence)
    .slice(0, options.limit || 20)
    .map((entry) => entry.item);
}

module.exports = {
  EVENT_VERSION,
  appendEvent,
  buildDatasetProfileV2,
  buildEvidenceIndex,
  cleanText,
  createEvent,
  projectEvents,
  readEvents,
  searchEvidence,
  slug,
};
