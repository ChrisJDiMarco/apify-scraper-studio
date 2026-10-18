'use strict';
// The trend cards the studio sends to Monday.com, built on the server from studio state (the renderer never sends card
// contents). The stage rules mirror buildTrendBoard in src/shared/trend-board.js (ESM, renderer-side), like index.js
// helpTrendStage and channel-view.js do; test/monday-cards.test.js keeps the two in step. Pure: no I/O.
const crypto = require('crypto');
const catalog = require('../shared/monday.json');
const kit = require('../shared/asset-kit');

const list = (value) => (Array.isArray(value) ? value : []);
const ACTIVE = new Set(['queued', 'running']);
const TROUBLE = new Set(['failed', 'partial', 'cancelled']);
const REPORT_DELIVERABLES = new Set(['evidence-report', 'editorial-toolkit']);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const day = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''; };
const shortDate = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
const httpsUrl = (value) => (/^https:\/\/\S+$/i.test(String(value || '')) ? String(value) : '');
const DECISION_WORD = { approved: 'Yes', passed: 'Skip' };

function baseCard(run, theme, programName) {
  return {
    key: `${run.id}:${theme.id}`, runId: run.id, themeId: theme.id,
    name: clean(theme.name, 255) || 'Untitled trend', description: String(theme.description || '').slice(0, 2000),
    evidenceCount: Number(theme.evidenceCount ?? list(theme.evidenceIds).length) || 0, platforms: list(theme.platforms).map((p) => clean(p, 40)).slice(0, 8),
    category: theme.scoring?.taxonomy?.category && theme.scoring.taxonomy.category !== 'UNMAPPED' ? clean(theme.scoring.taxonomy.category, 80) : clean(theme.taxonomyCategory, 80),
    priorityTier: theme.scoring?.priorityTier || '', programName: clean(programName || run.title || 'Research run', 160), discoveredAt: run.createdAt || '',
  };
}

// Same placement as buildTrendBoard: quick scans never become cards, a cancelled run with no reports leaves, a run
// waiting for review takes decisions, and after review a trend is Passed, In production or Ready.
function stageCards({ researchRuns = [], contentRuns = [], assets = [], programs = [] } = {}) {
  const programNames = new Map(list(programs).map((program) => [program.id, program.name]));
  const contentById = new Map(list(contentRuns).map((run) => [run.id, run]));
  const cards = [];
  for (const run of list(researchRuns)) {
    if (run.origin === 'quick-scan') continue;
    const discovered = list(run.discoveredThemes).length ? run.discoveredThemes : list(run.themes);
    if (!discovered.length) continue;
    if (run.status === 'cancelled' && !run.reportRunIds?.length) continue;
    const programName = programNames.get(run.programId);
    const decisions = run.decisions || {};
    if (run.status === 'awaiting-review') {
      for (const theme of discovered) { const decision = decisions[theme.id]; cards.push({ ...baseCard(run, theme, programName), run, stage: decision === 'approved' ? 'approved' : decision === 'passed' ? 'passed' : 'potential', decision: decision || 'pending', canDecide: true, reportAssets: [] }); }
      continue;
    }
    const approved = new Map(list(run.themes).map((theme) => [theme.id, theme]));
    for (const original of discovered) {
      const theme = approved.get(original.id);
      if (!theme) { cards.push({ ...baseCard(run, original, programName), run, stage: 'passed', decision: 'passed', canDecide: false, reportAssets: [] }); continue; }
      const card = { ...baseCard(run, theme, programName), run, decision: 'approved', canDecide: false, reportAssets: [] };
      const entry = list(run.reportRunIds).find((row) => row.themeId === theme.id);
      const report = entry && contentById.get(entry.runId);
      if (report?.status === 'succeeded') {
        const reportAssets = list(assets).filter((asset) => asset.runId === report.id && REPORT_DELIVERABLES.has(asset.deliverableId));
        const ids = new Set(reportAssets.map((asset) => asset.id));
        const creating = list(contentRuns).some((row) => row.sourceAssetId && ids.has(row.sourceAssetId) && ACTIVE.has(row.status));
        cards.push({ ...card, stage: creating ? 'production' : 'ready', report, reportAssets });
        continue;
      }
      cards.push({ ...card, stage: 'production', needsAttention: TROUBLE.has(report?.status) || (TROUBLE.has(run.status) && !ACTIVE.has(report?.status)), report: report || null });
    }
  }
  return cards;
}

// The Monday cards. adoptions: team-store rows for this workspace; history: trend-history's { trends } for the
// workspace (momentum and the same trend across runs); docLinks: { assetId: Google Doc url } from the Drive receipts;
// items: the store's item map (for "Seen before"); from 'now' keeps runs created after linkedAt; includeSkipped false
// drops Passed cards.
function buildMondayCards({ researchRuns = [], contentRuns = [], assets = [], programs = [], adoptions = [], history = null, editionId = 'general', origin = '', linkedAt = '', from = 'all', includeSkipped = true, docLinks = {}, items = {} } = {}) {
  const base = String(origin || '').replace(/\/+$/, '');
  const folders = new Map(kit.kitFolders(editionId).map((folder) => [folder.id, folder.name]));
  const trends = list(history?.trends);
  const trendOf = (runId, themeId) => trends.find((trend) => list(trend.appearances).some((entry) => entry.runId === runId && entry.themeId === themeId)) || null;
  const today = new Date().toISOString().slice(0, 10);
  const linked = Date.parse(linkedAt || '');
  const reportLink = (assetsOf, deliverableId) => { const asset = assetsOf.find((row) => row.deliverableId === deliverableId); if (!asset) return ''; return httpsUrl(docLinks[asset.id]) || (base ? `${base}/#/report/${encodeURIComponent(asset.id)}` : ''); };
  const cards = stageCards({ researchRuns, contentRuns, assets, programs })
    .filter((card) => (from !== 'now' || !Number.isFinite(linked) || Date.parse(card.discoveredAt || '') >= linked) && (includeSkipped !== false || card.stage !== 'passed'))
    .map((card) => {
      const { run, report, reportAssets, ...rest } = card;
      const by = run.decisionsBy?.[card.themeId] || null;
      const adoption = list(adoptions).filter((row) => row.themeId === card.themeId && ['using', 'not-using'].includes(row.status))
        .map((row) => ({ channelId: row.channelId, channelName: folders.get(row.channelId) || clean(row.channelId, 60), status: row.status, link: httpsUrl(row.link), plannedFor: row.status === 'using' ? String(row.plannedFor || '').slice(0, 10) : '', byName: clean(row.by?.name, 120), at: row.at || '' }))
        .sort((a, b) => a.channelName.localeCompare(b.channelName));
      const planned = adoption.map((row) => row.plannedFor).filter((value) => value && value >= today).sort()[0] || adoption.map((row) => row.plannedFor).filter(Boolean).sort()[0] || '';
      const trend = trendOf(card.runId, card.themeId);
      return {
        ...rest,
        momentum: trend?.momentum || '', trendId: trend?.trendId || '',
        decidedBy: by && card.decision !== 'pending' ? { id: String(by.id || ''), name: clean(by.name, 120), at: by.at || '', note: clean(by.note, 280), via: by.via === 'monday' ? 'monday' : '' } : null,
        reportUrl: reportLink(reportAssets, 'evidence-report'), toolkitUrl: reportLink(reportAssets, 'editorial-toolkit'), reportsReady: card.stage === 'ready' || (card.stage === 'production' && reportAssets.length > 0),
        studioUrl: base ? `${base}/#/trend/${encodeURIComponent(card.themeId)}` : '',
        adoption, plannedFor: planned, seenBefore: null,
      };
    });
  // "Seen before": the oldest other card of the same tracked trend that already has a Monday item.
  for (const card of cards) {
    if (!card.trendId) continue;
    const earlier = cards.filter((other) => other !== card && other.trendId === card.trendId && items[other.key]?.itemId && String(other.discoveredAt) < String(card.discoveredAt)).sort((a, b) => String(a.discoveredAt).localeCompare(String(b.discoveredAt)))[0];
    if (earlier) card.seenBefore = { discoveredAt: earlier.discoveredAt, key: earlier.key, url: httpsUrl(items[earlier.key].url) };
  }
  return cards;
}

// The milestones that earn an update on the item (posted once each): the yes, reports ready, and each channel's answer.
function milestones(card) {
  const out = [];
  if (card.decidedBy && card.decision === 'approved') out.push({ id: 'approved', text: `${card.decidedBy.name || 'Someone'} said Yes${card.decidedBy.via === 'monday' ? ' on Monday.com' : ' in the studio'}${card.decidedBy.note ? `: “${card.decidedBy.note}”` : '.'}` });
  if (card.reportsReady && card.stage === 'ready') out.push({ id: 'reports-ready', text: `The trends report and editorial toolkit are ready.${card.reportUrl ? ` ${card.reportUrl}` : ''}` });
  for (const row of card.adoption) out.push({ id: `adoption:${row.channelId}:${row.status}`, text: row.status === 'using' ? `${row.channelName} plans to use this trend${row.plannedFor ? ` · ${shortDate(row.plannedFor)}` : ''}${row.link ? ` · ${row.link}` : ''}` : `${row.channelName}: not for us.` });
  return out;
}

const channelsText = (card) => card.adoption.map((row) => [`${row.channelName}: ${row.status === 'using' ? 'using' : 'not for us'}`, row.plannedFor && shortDate(row.plannedFor), row.link].filter(Boolean).join(' · ')).join('\n').slice(0, catalog.limits.channelsChars);
function notesText(card) {
  const sources = card.platforms.length ? ` from ${card.platforms.map((p) => ({ x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' }[p] || p)).join(', ')}` : '';
  return [card.description, `${card.evidenceCount} source${card.evidenceCount === 1 ? '' : 's'}${sources}.`, card.programName && `Research program: ${card.programName}.`,
    card.decidedBy?.note && `Note for the channels: ${card.decidedBy.note}`, card.seenBefore && `Seen before: ${shortDate(card.seenBefore.discoveredAt)}${card.seenBefore.url ? ` · ${card.seenBefore.url}` : ''}`].filter(Boolean).join('\n\n').slice(0, 2000);
}
const decidedText = (by, decision) => (by ? [by.name || 'Someone', DECISION_WORD[decision] || '', shortDate(by.at)].filter(Boolean).join(' · ') + (by.via === 'monday' ? ' (Monday.com)' : '') : '');
const personByName = (people, name) => { const want = String(name || '').trim().toLowerCase(); if (!want) return ''; return Object.entries(people || {}).find(([, person]) => String(person.name || '').trim().toLowerCase() === want)?.[0] || ''; };

// { fieldId: normalized value } for every mapped field the studio writes, keyed to the link's column types.
function fieldValues(card, link, { people = {} } = {}) {
  const columns = link?.columns || {}; const info = link?.columnInfo || {}; const options = link?.fieldOptions || {};
  const labels = { ...catalog.stageLabels, ...(link?.statusLabels || {}) };
  const typeOf = (field) => info[columns[field]]?.type || '';
  const out = { name: card.name };
  const set = (field, value) => { if (field === 'name' || columns[field]) out[field] = value; };
  set('stage', labels[card.stage] || '');
  set('studioKey', card.key);
  set('priority', catalog.priorityLabels[card.priorityTier] || '');
  set('category', typeOf('category') === 'dropdown' ? (card.category ? [card.category] : []) : card.category);
  set('momentum', catalog.momentumLabels[card.momentum] || '');
  set('sources', card.evidenceCount);
  set('program', typeOf('program') === 'dropdown' ? (card.programName ? [card.programName] : []) : card.programName);
  set('foundOn', day(card.discoveredAt));
  set('decidedBy', typeOf('decidedBy') === 'people' ? (card.decidedBy ? [personByName(people, card.decidedBy.name)].filter(Boolean) : []) : decidedText(card.decidedBy, card.decision));
  set('reportLink', card.reportUrl ? { url: card.reportUrl, text: 'Trends report' } : '');
  set('toolkitLink', card.toolkitUrl ? { url: card.toolkitUrl, text: 'Editorial toolkit' } : '');
  set('studioLink', card.studioUrl ? { url: card.studioUrl, text: 'Open in studio' } : '');
  set('channels', typeOf('channels') === 'dropdown' ? card.adoption.filter((row) => row.status === 'using').map((row) => row.channelName) : channelsText(card));
  if ((options.plannedDate?.direction || 'toMonday') === 'toMonday') set('plannedDate', card.plannedFor || '');
  if ((options.owner?.direction || 'fromMonday') === 'toMonday') set('owner', card.decidedBy && card.decision === 'approved' ? [personByName(people, card.decidedBy.name)].filter(Boolean) : []);
  set('notes', notesText(card));
  return out;
}

const hashOf = (type, value) => crypto.createHash('sha1').update(JSON.stringify([type, value])).digest('hex').slice(0, 16);
// Which fields changed since the last push: { changed: { fieldId: value }, hashes: { fieldId: hash } } (all fields).
function diff(values, pushed = {}, types = {}) {
  const changed = {}; const hashes = {};
  for (const [field, value] of Object.entries(values)) { const hash = hashOf(types[field] || '', value); hashes[field] = hash; if (pushed[field] !== hash) changed[field] = value; }
  return { changed, hashes };
}

module.exports = { buildMondayCards, stageCards, fieldValues, diff, hashOf, milestones, notesText, channelsText };
