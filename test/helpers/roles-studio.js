// A small Semrush studio on disk for the roles tests that load the real main process: one approved trend
// ("AI Citation Tracking") whose report run wrote the comprehensive report and the editorial toolkit, a Social Team set
// made from it (with costs and receipts, which a Blog owner must never see), a research program and a team.
const fs = require('fs');
const path = require('path');
const content = require('../../src/shared/content-studio.js');

const AT = '2026-10-10T10:00:00.000Z';
const TREND = 'AI Citation Tracking';
const THEME = { id: 'theme-citations', name: TREND, description: 'Teams can’t tie AI citations to revenue.', evidenceCount: 12, scoring: { priorityTier: 'FAST-TRACK', taxonomy: { category: 'AI search' } } };
const POST = { id: 'post-1', text: 'We still cannot prove ROI from AI citations.', url: 'https://x.com/someone/status/1', platform: 'x', author: 'someone', publishedAt: '2026-10-01' };
const doc = (title, body, extra = {}) => ({ title, summary: `${title} summary.`, sections: [{ id: 'main', heading: 'What happened', body, items: [], evidenceIds: [], productIds: [] }], caveats: [], ...extra });

const MEMBERS = {
  chris: { id: 'member-chris', name: 'Chris', email: 'chris@semrush.com', role: 'admin', channelId: null },
  riley: { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null },
  alex: { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog' },
  sam: { id: 'member-sam', name: 'Sam', email: 'sam@semrush.com', role: 'channel', channelId: 'social' },
};
// The identity studio-server hands the main process for a member signed in with their link.
const identity = (member) => ({ id: member.id, name: member.name, email: member.email, role: member.role, channelId: member.channelId, via: 'link', disabled: false, memberSince: AT });

function writeRunFile(root, runId, name, value) {
  const dir = path.join(root, 'runs', runId); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}
function textAsset(root, { id, runId, deliverableId, title, channel, output, createdAt = AT }) {
  writeRunFile(root, runId, `${id}.json`, output);
  writeRunFile(root, runId, `${id}.md`, content.renderContentExport(output));
  writeRunFile(root, runId, `${id}.html`, content.renderContentExport(output, { format: 'html' }));
  return { id, workspaceId: 'semrush', runId, deliverableId, title, kind: 'text', channel, format: 'markdown', createdAt, reviewStatus: 'draft' };
}

// Writes content-studio/state.json (and its run files), data.json settings and, unless team is false, team.json.
function seedStudio(dataDir, { team = true, settings = { aiProvider: 'codex' } } = {}) {
  const root = path.join(dataDir, 'content-studio'); fs.mkdirSync(root, { recursive: true });
  const space = (id, editionId) => ({ id, name: editionId === 'semrush' ? 'Semrush workspace' : 'Your workspace', editionId, knowledge: content.validateBrandKnowledge(editionId === 'semrush' ? content.SEMRUSH_KNOWLEDGE_PRESET : {}, { editionId }), products: [], createdAt: AT, updatedAt: AT });
  writeRunFile(root, 'content-trend', 'input.json', { editionId: 'semrush', research: true, source: { id: 'theme-citations', kind: 'research-theme', title: TREND, text: 'Theme evidence package.', evidence: [POST], research: { themeId: 'theme-citations' } } });
  const report = textAsset(root, { id: 'asset-report', runId: 'content-trend', deliverableId: 'evidence-report', title: `${TREND} — Comprehensive Trends Report`, channel: 'Research', output: doc(`${TREND} — Comprehensive Trends Report`, 'Report: practitioners cannot tie AI citations to revenue.', { theme: { name: TREND }, evidenceRegister: [POST] }) });
  const toolkit = textAsset(root, { id: 'asset-toolkit', runId: 'content-trend', deliverableId: 'editorial-toolkit', title: `TREND: ${TREND}`, channel: 'Strategy', output: doc(`TREND: ${TREND}`, 'Toolkit: lead with the measurement gap.', { theme: { name: TREND } }) });
  writeRunFile(root, 'content-kit-social', 'input.json', { editionId: 'semrush', source: { id: 'trend-brief', kind: 'report', title: TREND, text: 'Brief text.' }, deliverableIds: ['social'] });
  const social = textAsset(root, { id: 'asset-kit-social', runId: 'content-kit-social', deliverableId: 'social', title: 'AI Citation Tracking social posts', channel: 'Social', output: doc('AI Citation Tracking social posts', 'Posts for LinkedIn and X.') });
  const state = {
    version: 1, activeWorkspaceId: 'semrush', workspaces: [space('general', 'general'), space('semrush', 'semrush')],
    programs: [{ id: 'program-pulse', workspaceId: 'semrush', name: 'AI search pulse', budgets: { collectionUsd: 20, aiUsd: 40 }, updatedAt: AT }, { id: 'program-weekly', workspaceId: 'semrush', name: 'Weekly listening', budgets: { collectionUsd: 20, aiUsd: 40 }, updatedAt: AT }],
    researchRuns: [{ id: 'research-review', workspaceId: 'semrush', type: 'research', title: 'Weekly listening', programId: 'program-weekly', createdBy: { id: 'member-riley', name: 'Riley' }, status: 'awaiting-review', stage: 'theme-review', createdAt: '2026-10-15T14:30:00.000Z', maxBudgetUsd: 40, reservedUsd: 3, costUsd: 2.5, receipts: [], themes: [], discoveredThemes: [], decisions: {} }, { id: 'research-1', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'succeeded', stage: 'reports', createdAt: AT, approvedAt: AT, maxBudgetUsd: 40, reservedUsd: 12, costUsd: 11.5, receipts: [{ stage: 'theme-synthesis', costUsd: 3.25 }], themes: [THEME], discoveredThemes: [THEME], decisions: { 'theme-citations': 'approved' }, reportRunIds: [{ themeId: 'theme-citations', runId: 'content-trend' }] }],
    contentRuns: [
      { id: 'content-kit-social', workspaceId: 'semrush', type: 'content', title: TREND, sourceAssetId: 'asset-report', kit: { version: 1, sourceKey: 'theme:theme-citations', sourceKind: 'trend', sourceTitle: TREND, folderName: `Golden Thread — ${TREND}`, concurrency: 3, estimateUsd: 0.9, reportAssetId: 'asset-report', themeId: 'theme-citations' }, ai: { model: 'claude-opus-5-5', effort: 'high' }, status: 'succeeded', stage: 'content', createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:05:00.000Z', maxBudgetUsd: 4, reservedUsd: 0.8, costUsd: 0.77, receipts: [{ stage: 'output-social', costUsd: 0.77, model: 'claude-opus-5-5' }], warnings: [], progress: { completed: 1, total: 1 }, jobs: [{ id: 'social', label: 'Social Team — LinkedIn + X + FB Captions', kind: 'text', folder: 'Semrush Social Team', status: 'succeeded', assetId: 'asset-kit-social' }] },
      { id: 'content-trend', workspaceId: 'semrush', type: 'content', title: TREND, researchRunId: 'research-1', themeId: 'theme-citations', status: 'succeeded', stage: 'content', createdAt: AT, updatedAt: AT, maxBudgetUsd: 6, reservedUsd: 2, costUsd: 1.5, receipts: [{ stage: 'output-evidence-report', costUsd: 1.5 }], jobs: [{ id: 'evidence-report', status: 'succeeded', assetId: 'asset-report' }, { id: 'editorial-toolkit', status: 'succeeded', assetId: 'asset-toolkit' }] },
    ],
    themes: [{ ...THEME, workspaceId: 'semrush', status: 'active', firstDetectedAt: AT, lastDetectedAt: AT }], history: [], detections: [],
    assets: [social, toolkit, report], exports: [], datasetOwners: {},
  };
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ settings }));
  if (team) fs.writeFileSync(path.join(root, 'team.json'), JSON.stringify({ version: 1, members: Object.values(MEMBERS).map((member) => ({ ...member, disabled: false, createdAt: AT, updatedAt: AT, createdBy: { id: 'system', name: 'Automatic' }, lastSeenAt: '', link: null })), adoptions: [], activity: [], prefs: {} }));
  return { root, TREND };
}

module.exports = { AT, TREND, MEMBERS, identity, seedStudio };
