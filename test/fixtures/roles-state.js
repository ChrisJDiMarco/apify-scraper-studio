// A Semrush studio as publicState() returns it, shaped like content-workspace's records: research runs at every stage,
// paired report runs, channel kits (one shared across channels), the theme repository and assets. Costs, receipts,
// programs and keys are filled in so projections can be checked for what they leave out. Fresh copies on every call.
const at = (day, time = '10:00:00') => `2026-${day}T${time}.000Z`;
const text = (id, runId, deliverableId, title, createdAt, extra = {}) => ({ id, workspaceId: 'semrush', runId, deliverableId, title, kind: 'text', channel: 'Research', format: 'markdown', createdAt, reviewStatus: 'draft', ...extra });
const image = (id, runId, deliverableId, variantIndex, createdAt) => ({ id, workspaceId: 'semrush', runId, deliverableId, variantIndex, imageCallId: `image-call-${runId}`, title: `Hero ${variantIndex + 1}`, kind: 'image', channel: 'Design', format: 'png', createdAt, receipt: { costUsd: 0.04, attemptId: `${id}-a` }, reviewStatus: 'draft' });
const theme = (id, name, tier, extra = {}) => ({ id, name, description: `${name}: what practitioners are saying.`, evidenceCount: 12, platforms: ['x', 'reddit'], novelty: 'NEW ANGLE', matchingKeywords: ['ai'], taxonomyCategory: 'AI search', scoring: { priorityTier: tier, priorityScore: 80, velocity: 'RISING', count: 1, taxonomy: { category: 'AI search' } }, ...extra });
const reportRun = (id, researchRunId, themeId, title, status, createdAt) => ({ id, workspaceId: 'semrush', type: 'content', title, researchRunId, themeId, status, stage: 'content', createdAt, updatedAt: createdAt, maxBudgetUsd: 6, reservedUsd: 2.4, costUsd: 2.1, receipts: [{ stage: 'output-evidence-report', costUsd: 1.4 }], warnings: [], ai: { model: 'claude-opus-5-5', effort: 'high' }, jobs: [{ id: 'evidence-report', label: 'Comprehensive trends report', kind: 'text', status: status === 'succeeded' ? 'succeeded' : 'failed' }, { id: 'editorial-toolkit', label: 'Editorial toolkit brief', kind: 'text', status: status === 'succeeded' ? 'succeeded' : 'failed' }] });
const kitRun = (id, { themeId, sourceTitle, reportAssetId, status, createdAt, jobs, createdBy, message }) => ({
  id, workspaceId: 'semrush', type: 'content', title: sourceTitle, sourceAssetId: reportAssetId,
  kit: { version: 1, sourceKey: `theme:${themeId}`, sourceKind: 'trend', sourceTitle, folderName: `Golden Thread — ${sourceTitle} (${createdAt.slice(0, 10)})`, concurrency: 3, estimateUsd: 4.2, reportAssetId, themeId },
  ai: { model: 'claude-opus-5-5', effort: 'high' }, status, stage: 'content', createdAt, updatedAt: createdAt, maxBudgetUsd: 15, reservedUsd: 3.1, costUsd: 2.9,
  receipts: [{ stage: 'output-blogshort', costUsd: 0.4, model: 'claude-opus-5-5' }], warnings: ['No product registry is loaded.'], progress: { completed: jobs.filter((job) => job.status === 'succeeded').length, total: jobs.length },
  message: message || (status === 'succeeded' ? `All ${jobs.length} assets are ready.` : 'Writing Semrush Blog — Long-form Article'), jobs, ...(createdBy ? { createdBy } : {}),
});
const job = (id, label, folder, status, extra = {}) => ({ id, label, kind: id.includes('image') ? 'image' : 'text', folder, status, ...extra });

function contentStudio() {
  const researchRuns = [
    { id: 'research-review', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'awaiting-review', stage: 'theme-review', createdAt: at('10-14'), maxBudgetUsd: 40, reservedUsd: 6, costUsd: 5.5, ownCostUsd: 5.5, receipts: [{ stage: 'theme-synthesis', costUsd: 2 }],
      themes: [theme('theme-agents', 'Agentic checkout', 'STRONG'), theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK')], discoveredThemes: [theme('theme-agents', 'Agentic checkout', 'STRONG'), theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK')],
      decisions: { 'theme-agents': 'approved' }, decisionsBy: { 'theme-agents': { id: 'member-riley', name: 'Riley', at: at('10-14', '12:00:00') } } },
    { id: 'research-new', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'succeeded', stage: 'reports', createdAt: at('10-10'), approvedAt: at('10-10', '11:00:00'), maxBudgetUsd: 40, reservedUsd: 30, costUsd: 28, ownCostUsd: 9, receipts: [],
      themes: [theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK'), theme('theme-local', 'Local packs shrink', 'MONITOR')],
      discoveredThemes: [theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK'), theme('theme-local', 'Local packs shrink', 'MONITOR'), theme('theme-voice', 'Voice search returns', 'LOW')],
      decisions: { 'theme-aio': 'approved', 'theme-local': 'approved', 'theme-voice': 'passed' }, decisionsBy: { 'theme-aio': { id: 'member-riley', name: 'Riley', at: at('10-10', '10:55:00') }, 'theme-voice': { id: 'member-riley', name: 'Riley', at: at('10-10', '10:56:00') } },
      reportRunIds: [{ themeId: 'theme-aio', runId: 'content-report-aio-2' }, { themeId: 'theme-local', runId: 'content-report-local' }] },
    { id: 'research-old', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'partial', stage: 'reports', createdAt: at('09-01'), approvedAt: at('09-01', '12:00:00'), maxBudgetUsd: 40, reservedUsd: 20, costUsd: 18, receipts: [],
      themes: [theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK'), theme('theme-zero', 'Zero-click searches', 'STRONG')],
      discoveredThemes: [theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK'), theme('theme-zero', 'Zero-click searches', 'STRONG')],
      decisions: { 'theme-aio': 'approved', 'theme-zero': 'approved' }, autoApproved: true, decisionsBy: { 'theme-aio': { id: 'system', name: 'Automatic', at: at('09-01', '12:00:00') }, 'theme-zero': { id: 'system', name: 'Automatic', at: at('09-01', '12:00:00') } },
      reportRunIds: [{ themeId: 'theme-aio', runId: 'content-report-aio-1' }, { themeId: 'theme-zero', runId: 'content-report-zero' }] },
    { id: 'research-cancelled', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'cancelled', stage: 'theme-review', createdAt: at('08-20'), maxBudgetUsd: 40, reservedUsd: 2, costUsd: 2, receipts: [],
      themes: [theme('theme-old', 'Old idea', 'LOW')], discoveredThemes: [theme('theme-old', 'Old idea', 'LOW')], decisions: {} },
    { id: 'research-running', workspaceId: 'semrush', type: 'research', title: 'AI search pulse', programId: 'program-pulse', status: 'running', stage: 'discovery', createdAt: at('10-15'), maxBudgetUsd: 40, reservedUsd: 1, costUsd: 0.5, receipts: [], themes: [] },
  ];
  const contentRuns = [
    kitRun('content-kit-local', { themeId: 'theme-local', sourceTitle: 'Local packs shrink', reportAssetId: 'asset-local-report', status: 'running', createdAt: at('10-15', '09:00:00'), createdBy: { id: 'member-sam', name: 'Sam' },
      jobs: [job('social', 'Social Team — LinkedIn + X + FB Captions', 'Semrush Social Team', 'running'), job('brand-image', 'Social Team — Hero Graphic', 'Semrush Social Team', 'queued')] }),
    kitRun('content-kit-shared', { themeId: 'theme-aio', sourceTitle: 'AI Overviews eat clicks', reportAssetId: 'asset-aio-report-2', status: 'partial', createdAt: at('10-13'), createdBy: { id: 'member-jordan', name: 'Jordan' }, message: 'Some assets need another try. Finished ones are saved.',
      jobs: [job('blogshort', 'Blog — Short News Update', 'Semrush Blog', 'failed', { error: 'Run budget exhausted. Increase the budget before retrying.' }), job('social', 'Social Team — LinkedIn + X + FB Captions', 'Semrush Social Team', 'succeeded', { assetId: 'asset-kit-shared-social' }), job('brand-image', 'Social Team — Hero Graphic', 'Semrush Social Team', 'succeeded', { assetId: 'image-shared-0', assetIds: ['image-shared-0', 'image-shared-1', 'image-shared-2'], imageCalls: [{ id: 'image-call-x', allowanceUsd: 0.3, attempts: [] }] })] }),
    kitRun('content-kit-blog', { themeId: 'theme-aio', sourceTitle: 'AI Overviews eat clicks', reportAssetId: 'asset-aio-report-2', status: 'succeeded', createdAt: at('10-12'), createdBy: { id: 'member-alex', name: 'Alex' },
      jobs: [job('blogshort', 'Blog — Short News Update', 'Semrush Blog', 'succeeded', { assetId: 'asset-kit-blog-short' }), job('bloglong', 'Blog — Long-form Article', 'Semrush Blog', 'succeeded', { assetId: 'asset-kit-blog-long' })] }),
    reportRun('content-report-local', 'research-new', 'theme-local', 'Local packs shrink', 'succeeded', at('10-11', '20:00:00')),
    reportRun('content-report-aio-2', 'research-new', 'theme-aio', 'AI Overviews eat clicks', 'succeeded', at('10-11')),
    reportRun('content-report-aio-1', 'research-old', 'theme-aio', 'AI Overviews eat clicks', 'succeeded', at('09-02')),
    reportRun('content-report-zero', 'research-old', 'theme-zero', 'Zero-click searches', 'failed', at('09-02')),
    { id: 'content-campaign', workspaceId: 'semrush', type: 'content', title: 'Pasted brief', sourceAssetId: 'asset-local-report', status: 'succeeded', stage: 'content', createdAt: at('10-12', '15:00:00'), maxBudgetUsd: 5, reservedUsd: 1, costUsd: 1, receipts: [], jobs: [{ id: 'newsletter', label: 'Newsletter pack', kind: 'text', status: 'succeeded', assetId: 'asset-campaign-newsletter' }] },
  ];
  const assets = [
    text('asset-kit-shared-social', 'content-kit-shared', 'social', 'AI Overviews social posts', at('10-13', '10:20:00')),
    image('image-shared-0', 'content-kit-shared', 'brand-image', 0, at('10-13', '10:30:00')), image('image-shared-1', 'content-kit-shared', 'brand-image', 1, at('10-13', '10:30:00')), image('image-shared-2', 'content-kit-shared', 'brand-image', 2, at('10-13', '10:30:00')),
    text('asset-kit-blog-short', 'content-kit-blog', 'blogshort', 'AI Overviews: a short news update', at('10-12', '10:20:00'), { edited: { at: at('10-14'), by: { id: 'member-alex', name: 'Alex' } } }),
    text('asset-kit-blog-long', 'content-kit-blog', 'bloglong', 'AI Overviews: the long read', at('10-12', '10:40:00')),
    text('asset-campaign-newsletter', 'content-campaign', 'newsletter', 'Newsletter draft', at('10-12', '15:20:00')),
    text('asset-local-report', 'content-report-local', 'evidence-report', 'Local packs shrink — Comprehensive Trends Report', at('10-11', '19:00:00')),
    text('asset-local-toolkit', 'content-report-local', 'editorial-toolkit', 'TREND: Local packs shrink', at('10-11', '19:40:00')),
    text('asset-aio-report-2', 'content-report-aio-2', 'evidence-report', 'AI Overviews eat clicks — Comprehensive Trends Report', at('10-11', '09:00:00')),
    text('asset-aio-toolkit-2', 'content-report-aio-2', 'editorial-toolkit', 'TREND: AI Overviews eat clicks', at('10-11', '09:30:00'), { edited: { at: at('10-12', '08:00:00'), by: { id: 'member-riley', name: 'Riley' } } }),
    text('asset-aio-report-1', 'content-report-aio-1', 'evidence-report', 'AI Overviews eat clicks — Comprehensive Trends Report', at('09-02', '09:00:00')),
    text('asset-aio-toolkit-1', 'content-report-aio-1', 'editorial-toolkit', 'TREND: AI Overviews eat clicks', at('09-02', '09:30:00')),
  ];
  const themes = [
    { ...theme('theme-aio', 'AI Overviews eat clicks', 'FAST-TRACK'), workspaceId: 'semrush', status: 'active', firstDetectedAt: at('09-01'), lastDetectedAt: at('10-14'), detectionCount: 3, lastRunId: 'research-review', approvedRunId: 'research-new' },
    { ...theme('theme-zero', 'Zero-click searches', 'STRONG'), workspaceId: 'semrush', status: 'active', firstDetectedAt: at('09-01'), lastDetectedAt: at('09-01'), detectionCount: 1 },
    { ...theme('theme-local', 'Local packs shrink', 'MONITOR'), workspaceId: 'semrush', status: 'active', firstDetectedAt: at('10-10'), lastDetectedAt: at('10-10'), detectionCount: 1 },
    { ...theme('theme-voice', 'Voice search returns', 'LOW'), workspaceId: 'semrush', status: 'active', firstDetectedAt: at('10-10'), lastDetectedAt: at('10-10'), detectionCount: 1 },
    { ...theme('theme-agents', 'Agentic checkout', 'STRONG'), workspaceId: 'semrush', status: 'active', firstDetectedAt: at('10-14'), lastDetectedAt: at('10-14'), detectionCount: 1 },
    { ...theme('theme-old', 'Old idea', 'LOW'), workspaceId: 'semrush', status: 'archived', firstDetectedAt: at('08-20'), lastDetectedAt: at('08-20'), detectionCount: 1 },
  ];
  return {
    activeWorkspaceId: 'semrush',
    workspaces: [{ id: 'general', name: 'Your workspace', editionId: 'general', createdAt: at('08-01'), updatedAt: at('08-01') }, { id: 'semrush', name: 'Semrush workspace', editionId: 'semrush', knowledge: { name: 'Semrush', positioning: 'Private positioning notes.' }, products: [{ id: 'product-1', name: 'Enterprise SEO' }], referenceDocs: [{ id: 'doc-1', kind: 'icp', title: 'ICP', characters: 4000 }], taxonomy: { categories: [] }, createdAt: at('08-01'), updatedAt: at('10-01') }],
    programs: [{ id: 'program-pulse', workspaceId: 'semrush', name: 'AI search pulse', budgets: { collectionUsd: 20, aiUsd: 40 }, ai: { models: { reports: 'claude-opus-5-5' } }, schedule: { enabled: true, frequency: 'weekly' } }],
    researchRuns, contentRuns, themes, assets,
    availableDatasets: [{ id: 'dataset-1', name: 'X posts', platform: 'x', itemCount: 500, createdAt: at('10-01') }],
    availableReports: assets.filter((asset) => ['evidence-report', 'editorial-toolkit'].includes(asset.deliverableId)).map((asset) => ({ id: asset.id, assetId: asset.id, title: asset.title, createdAt: asset.createdAt })),
    capabilities: { imagesConfigured: true, googleConfigured: true, googlePublishConfigured: true, aiProvider: 'auto', textModel: 'claude-opus-5-5', imageProvider: 'OpenAI', imageModel: 'gpt-image-2.5-flare' },
  };
}

// The whole publicState(): data.json fields, keys as booleans, Monday and the v5 projection around the studio.
function baseState() {
  return {
    projects: [{ id: 'default', name: 'Default' }], recipes: [{ id: 'recipe-1', name: 'X search', input: { query: 'ai' } }], runs: [], datasets: [{ id: 'dataset-1', name: 'X posts', itemCount: 500 }], analyses: [], conversations: [],
    settings: { aiProvider: 'auto', aiModel: 'claude-opus-5-5', aiMaxBudgetUsd: 5, maxItems: 100, uiMode: 'classic', sheets: { workingSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/private' } },
    contentStudio: contentStudio(), intelligence: { nextActions: [] },
    keys: { APIFY_API_TOKEN: true, ANTHROPIC_API_KEY: true, OPENAI_API_KEY: true, MONDAY_API_TOKEN: false, GOOGLE_SHEETS_WEBHOOK_URL: true, GOOGLE_DOCS_ACCESS_TOKEN: false },
    monday: { connected: true, boardId: '42' }, jobs: [], v5: { missions: [], evidenceSummary: { sample: [{ text: 'A collected post.' }] } },
  };
}

const adoptions = () => [
  { id: 'adoption-1', workspaceId: 'semrush', themeId: 'theme-aio', channelId: 'blog', status: 'using', link: 'https://www.semrush.com/blog/ai-overviews/', note: '', trendName: 'AI Overviews eat clicks', by: { id: 'member-alex', name: 'Alex' }, at: at('10-13', '16:00:00'), updatedAt: at('10-13', '16:05:00') },
  { id: 'adoption-2', workspaceId: 'semrush', themeId: 'theme-local', channelId: 'social', status: 'not-using', link: '', note: 'Not our audience.', trendName: 'Local packs shrink', by: { id: 'member-sam', name: 'Sam' }, at: at('10-15', '11:00:00'), updatedAt: at('10-15', '11:00:00') },
  { id: 'adoption-3', workspaceId: 'general', themeId: 'theme-aio', channelId: 'social', status: 'using', link: '', note: '', trendName: 'Other workspace', by: { id: 'member-sam', name: 'Sam' }, at: at('10-13'), updatedAt: at('10-13') },
];
const members = () => [
  { id: 'member-chris', name: 'Chris', email: 'chris@semrush.com', role: 'admin', channelId: null, disabled: false, createdAt: at('08-01'), lastSeenAt: at('10-15') },
  { id: 'member-riley', name: 'Riley', email: 'riley@semrush.com', role: 'editor', channelId: null, disabled: false, createdAt: at('08-02') },
  { id: 'member-alex', name: 'Alex', email: 'alex@semrush.com', role: 'channel', channelId: 'blog', disabled: false, createdAt: at('10-01') },
  { id: 'member-sam', name: 'Sam', email: 'sam@semrush.com', role: 'channel', channelId: 'social', disabled: false, createdAt: at('10-05') },
  { id: 'member-old', name: 'Olive', email: 'olive@semrush.com', role: 'channel', channelId: 'pr', disabled: true, createdAt: at('08-03') },
];

module.exports = { at, contentStudio, baseState, adoptions, members };
