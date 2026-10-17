'use strict';
// The Prompt Library's preview and test runs (SPEC-2 §A): for one prompt and one sample, the exact prompt the stage
// builds, the schema it asks for and the stage's own validator, through the same builders the runs use. Pure; the
// sample (a recent run's data or prompt-samples.json) and the block texts come from prompt-lab.js.
const research = require('../shared/research-program');
const researchPrompts = require('../shared/research-prompts');
const content = require('../shared/content-studio');
const { snapshotBlocks } = require('../shared/prompt-template');
const reports = () => require('../shared/research-reports');
const scanReports = () => require('../shared/research-scan-report');
const kit = () => require('../shared/asset-kit');
const findings = () => require('../shared/findings-chat');
const dataPrompts = () => require('../shared/data-prompts');
const codex = () => require('../shared/codex-runner');

// The other prompts a prompt's text is built with, so a preview shows them as they are saved in this workspace.
const RELATED = {
  'assets.shared': ['assets.blogshort'],
  'pictures.kit-brief': ['pictures.direction'],
  'pictures.kit-image': ['pictures.direction', 'pictures.variations'],
  'pictures.variations': ['pictures.direction', 'pictures.kit-image'],
  'pictures.direction': ['pictures.kit-image', 'pictures.variations'],
  'pictures.content-image': ['assets.shared', 'pictures.direction', 'pictures.variations'],
  'video.brief': ['pictures.direction'], 'video.clip': ['pictures.direction', 'video.brief'],
  'data.dataset-report': ['data.analysis-rules'], 'data.tag-items': ['data.analysis-rules'], 'data.threads': ['data.analysis-rules'], 'data.analysis-rules': ['data.dataset-report'],
};
function relatedIds(promptId) {
  if (promptId.startsWith('assets.') && promptId !== 'assets.shared') return [promptId, 'assets.shared'];
  return [promptId, ...(RELATED[promptId] || [])];
}
const PICTURE_USD = 0.06; // asset-kit KIT_IMAGE_USD: one 1536×1024 picture, rounded up
const pictureDeliverable = (editionId, prompts, id = 'brand-image') => content.buildContentPlan({ editionId, source: { id: 'picture-source', kind: 'text', title: 'Picture', text: 'Picture source.' }, deliverableIds: [id], imageVariants: 3, prompts }).deliverables[0];
const videoDeliverable = (editionId, prompts) => content.buildContentPlan({ editionId, source: { id: 'video-source', kind: 'text', title: 'Video', text: 'Video source.' }, deliverableIds: ['social-video'], prompts }).deliverables[0];
// A plan for previewing the video prompt when the sample has none of its own.
const SAMPLE_VIDEO_BRIEF = { title: 'Answers move into the search results', prompt: 'A marketer at a bright desk scrolls a search results page on a laptop while answer panels slide into view above the links. The camera pushes in slowly over her shoulder, then cuts to her notebook as she circles one result. Soft daylight, calm pace.', onScreenText: ['Answers now sit above the links', 'Check which pages get cited'], keyframePrompt: 'A marketer at a bright desk looking at a laptop showing a search results page.', avoid: ['Real brand logos', 'Charts without numbers'], evidenceIds: [] };
const batchOf = (sample, posts, stage) => ({ id: `batch-${stage}-sample`, runId: sample.runId, stage, index: 1, totalBatches: 1, platform: posts[0]?.platform || 'x', platformBatchNumber: 1, items: posts, evidenceIds: posts.map((post) => post.id) });
const firstPlatform = (posts) => { const platform = ['x', 'linkedin', 'reddit'].find((p) => posts.some((post) => post.platform === p)); return posts.filter((post) => post.platform === platform); };
// A run's saved brand knowledge is used as it is; the bundled sample's made-up brand becomes Semrush in that edition.
const brandOf = (sample, editionId) => (sample.brandKnowledge?.editionId === editionId ? sample.brandKnowledge : { ...sample.brandKnowledge, editionId, ...(editionId === 'semrush' ? { name: 'Semrush' } : {}) });

// build(promptId, { editionId, brandName, sample, prompts, trace, role }) → { kind: 'text'|'image'|'none', prompt, schema,
// validate(raw) → checked output, outputTokens, pictures (image runs: the picture prompts, first one tested) }.
// references: the campaign set's reference images as roles ([{ role: 'style' | 'logo' }]); picture prompts name them as
// their runs do. The default (none) renders exactly the prompts the goldens hold.
function build(promptId, { editionId = 'general', brandName = '', sample, prompts = null, trace = false, role = 'admin', references = [] } = {}) {
  const blocks = snapshotBlocks(prompts, promptId); const edition = { editionId, brandName };
  switch (promptId) {
    case 'research.discovery': {
      const batch = batchOf(sample, firstPlatform(sample.posts), 'discovery');
      return { kind: 'text', prompt: researchPrompts.discoveryPrompt({ batch, query: sample.query || '', ...edition, blocks, trace }), schema: research.DISCOVERY_SCHEMA, validate: (raw) => research.validateCandidates(raw, { runId: sample.runId, batch }), outputTokens: 3500 };
    }
    case 'research.synthesis': {
      const maxThemes = Math.min(6, Math.max(1, Number(sample.maxThemes) || 3));
      const sources = Object.fromEntries(['x', 'linkedin', 'reddit'].map((p) => [research.PLATFORM_LABELS[p], sample.posts.filter((post) => post.platform === p).length]).filter(([, count]) => count));
      return { kind: 'text', prompt: researchPrompts.synthesisPrompt({ candidates: sample.candidates, totalPosts: sample.posts.length, sources, maxThemes, taxonomy: sample.taxonomy || null, query: sample.query || '', ...edition, blocks, trace }), schema: { ...research.THEMES_SCHEMA, properties: { themes: { ...research.THEMES_SCHEMA.properties.themes, maxItems: maxThemes } } }, validate: (raw) => research.validateThemes(raw, { runId: sample.runId, candidates: sample.candidates, maxThemes, taxonomy: sample.taxonomy || null }), outputTokens: 6000 };
    }
    case 'research.matching':
      return { kind: 'text', prompt: researchPrompts.matchingPrompt({ themes: sample.themes, existing: sample.existingThemes || [], ...edition, blocks, trace }), schema: research.MATCHING_SCHEMA, validate: (raw) => research.validateThemeMatches(raw, { themes: sample.themes, existing: sample.existingThemes || [] }), outputTokens: 2500 };
    case 'research.tagging': {
      const batch = batchOf(sample, sample.posts.slice(0, 20), 'tagging');
      return { kind: 'text', prompt: researchPrompts.taggingPrompt({ batch, themes: sample.themes, ...edition, blocks, trace }), schema: research.ASSIGNMENTS_SCHEMA, validate: (raw) => research.validateAssignments(raw, { runId: sample.runId, batch, themes: sample.themes }), outputTokens: batch.items.length * 110 };
    }
    case 'reports.trends-report': {
      const request = reports().buildTrendReportRequest({ ...trendInput(sample, editionId), blocks, trace });
      return { kind: 'text', prompt: request.prompt, schema: request.schema, validate: (raw) => reports().validateTrendReport(raw, request.context), outputTokens: 8000 };
    }
    case 'reports.editorial-toolkit': {
      const trendReport = sample.trendReport || reports().validateTrendReport(sample.trendReportOutput, reports().buildTrendReportRequest(trendInput(sample, editionId)).context);
      const selection = sample.selection || reports().selectThemeEvidence({ theme: sample.themes[0], items: sample.posts, assignments: sample.assignments });
      const request = reports().buildToolkitRequest({ theme: sample.themes[0], trendReport, trendReportMarkdown: content.renderContentExport(trendReport), metrics: selection.metrics, registryText: sample.registryText || '', products: sample.products || [], referenceDocs: (sample.referenceDocs || []).filter((doc) => doc.kind !== 'registry'), enterpriseProducts: sample.enterpriseProducts || [], editionId, brandName: sample.reportPayload?.brandName || (editionId === 'semrush' ? 'Semrush' : brandName), blocks, trace });
      return { kind: 'text', prompt: request.prompt, schema: request.schema, validate: (raw) => reports().validateToolkit(raw, request.context).output, outputTokens: 5000 };
    }
    case 'reports.quick-scan': {
      // A recent quick scan's trends and posts (latestPromptSample), else the bundled sample's.
      const lib = scanReports(); const { scan, selection } = lib.samplePayload(sample);
      const request = lib.buildScanReportRequest({ scan, selection, editionId, brandName: editionId === 'semrush' ? 'Semrush' : brandName, audience: brandOf(sample, editionId)?.audience || '', blocks, trace });
      return { kind: 'text', prompt: request.prompt, schema: request.schema, validate: (raw) => lib.validateScanReport(raw, request.context), outputTokens: lib.OUTPUT_TOKENS };
    }
    case 'pictures.kit-brief': {
      const deliverable = pictureDeliverable(editionId, prompts);
      const request = kit().imageBriefRequest(deliverable, { editionId, source: sample.source, brandKnowledge: brandOf(sample, editionId), prompts }, { references, trace });
      return { kind: 'text', prompt: request.prompt, schema: kit().IMAGE_BRIEF_SCHEMA, validate: (raw) => kit().validateImageBrief(raw, request), outputTokens: 1200 };
    }
    case 'pictures.kit-image': case 'pictures.variations': case 'pictures.direction': {
      const deliverable = pictureDeliverable(editionId, prompts);
      const brief = kit().validateImageBrief(sample.brief, { evidenceIds: (sample.source?.evidence || []).map((entry) => entry.id) });
      const picture = kit().kitImageDeliverable(deliverable, brief, { editionId, label: deliverable.label, references, prompts, trace });
      return { kind: 'image', prompt: picture.variantPrompts.join('\n\n'), pictures: picture.variantPrompts, deliverable: picture, estimateUsd: PICTURE_USD * picture.variantPrompts.length };
    }
    case 'pictures.content-image': {
      const plan = content.buildContentPlan({ editionId, source: sample.source, brandKnowledge: brandOf(sample, editionId), productRegistry: sample.products || [], deliverableIds: ['brand-image'], imageVariants: 3, prompts, ...(references.length ? { references: { 'brand-image': references } } : {}) }, { trace });
      const deliverable = plan.deliverables[0];
      return { kind: 'image', prompt: deliverable.variantPrompts.join('\n\n'), pictures: deliverable.variantPrompts, deliverable, estimateUsd: PICTURE_USD * deliverable.variantPrompts.length };
    }
    case 'video.brief': {
      const deliverable = videoDeliverable(editionId, prompts);
      const request = kit().videoBriefRequest(deliverable, { editionId, source: sample.source, brandKnowledge: brandOf(sample, editionId), prompts }, { trace });
      return { kind: 'text', prompt: request.prompt, schema: kit().VIDEO_BRIEF_SCHEMA, validate: (raw) => kit().validateVideoBrief(raw, request), outputTokens: kit().VIDEO_BRIEF_OUTPUT_TOKENS };
    }
    case 'video.clip': {
      // A clip takes minutes and costs dollars, so it is previewed here and tried by making a video from a report.
      const deliverable = videoDeliverable(editionId, prompts);
      const brief = kit().validateVideoBrief(sample.videoBrief || SAMPLE_VIDEO_BRIEF, { evidenceIds: (sample.source?.evidence || []).map((entry) => entry.id) });
      return { kind: 'none', prompt: kit().kitVideoDeliverable(deliverable, brief, { editionId, prompts, trace }).prompt };
    }
    case 'assistant.ask-ai': {
      // help-assistant.js reads these blocks once it takes { blocks, trace } (a later phase); until then this shows the defaults.
      const { helpPromptParts } = require('./help-assistant');
      const parts = helpPromptParts({ question: sample.questions?.['assistant.ask-ai'] || 'What is rising this week?', history: [], context: { ...(sample.helpContext || {}), role, layout: 'simple' }, guide: '(The app guide is added here: docs/app-guide.md.)', role, blocks, trace });
      return { kind: 'none', prompt: parts.prefix + parts.body, outputTokens: 1500 };
    }
    case 'assistant.ask-datasets': {
      const context = findings().buildFindingsContext({ datasets: [{ dataset: sample.dataset, items: sample.datasetItems }], messages: [], question: sample.questions?.['assistant.ask-datasets'] || 'What are people saying?', blocks, trace });
      const prompt = context.prompt + findings().brandContextBlock([{ datasetId: sample.dataset.id, brand: sample.dataset.marketingBrief?.brandContext || sample.dataset.brandContext || null }]);
      return { kind: 'text', prompt, schema: findings().CHAT_SCHEMA, validate: (raw) => findings().normalizeFindingsAnswer(raw, context), outputTokens: 1500 };
    }
    case 'data.dataset-report': case 'data.tag-items': case 'data.threads': case 'data.analysis-rules': {
      const kind = promptId === 'data.tag-items' ? 'tag' : promptId === 'data.threads' ? 'thread' : 'report';
      const reportPresetId = sample.dataset.marketingBrief?.reportPresetId || '';
      const source = findings().buildFindingsContext({ datasets: [{ dataset: sample.dataset, items: sample.datasetItems }], question: 'Prepare the requested analysis.' });
      const analysisContext = codex().buildAnalysisContext({ dataset: sample.dataset, profile: null, kind, reportPresetId });
      analysisContext.rules = dataPrompts().analysisRules(snapshotBlocks(prompts, 'data.analysis-rules'));
      analysisContext.brandContext = sample.dataset.marketingBrief?.brandContext || sample.dataset.brandContext || null;
      const kindBlocks = snapshotBlocks(prompts, kind === 'tag' ? 'data.tag-items' : kind === 'thread' ? 'data.threads' : 'data.dataset-report');
      const prompt = dataPrompts().analysisPrompt({ kind, reportPresetId, analysisContext, coverage: source.coverage, items: source.items, blocks: kindBlocks, trace, traceRules: promptId === 'data.analysis-rules' && trace });
      return { kind: 'text', prompt, schema: codex().SCHEMAS[kind], validate: (raw) => codex().validateAiOutput(kind, raw), outputTokens: 4000 };
    }
    case 'data.workflow-asset-pack':
      return { kind: 'text', prompt: dataPrompts().assetPackPrompt(JSON.stringify(sample.assetPackContext, null, 2), { blocks, trace }), schema: codex().SCHEMAS.assetPack, validate: (raw) => codex().validateAiOutput('assetPack', raw), outputTokens: 4000 };
    case 'system.claude': return { kind: 'none', prompt: require('../shared/claude-runner').CLAUDE_SYSTEM_PROMPT };
    case 'system.codex-wrapper': return { kind: 'none', prompt: dataPrompts().codexWrapper('<run folder>/ai-input.txt') };
    case 'system.repair': return { kind: 'none', prompt: researchPrompts.repairInstruction(new Error('candidates.0.painPoint: Invalid painPoint.'), { candidates: [{ name: 'Example trend' }] }) };
    default: {
      if (promptId.startsWith('assets.')) {
        const deliverableId = promptId === 'assets.shared' ? 'blogshort' : promptId.slice('assets.'.length);
        const input = { editionId, source: sample.source, brandKnowledge: brandOf(sample, editionId), productRegistry: sample.products || [], deliverableIds: [deliverableId], imageVariants: 3, prompts };
        const deliverable = content.buildContentPlan(input, { trace }).deliverables[0];
        const outputTokens = { blogshort: 2500, bloglong: 6000, newsletter: 4000, ads: 3500, landingpage: 3500, pr: 3000, social: 2500, affiliate: 4500, enterprise: 4000, backlinko: 6000, explodingtopics: 2500, sel: 3500 }[deliverableId] || 3500;
        return { kind: 'text', prompt: deliverable.prompt, schema: deliverable.schema, validate: (raw) => content.validateContentOutput(raw, { deliverable, source: input.source, productRegistry: input.productRegistry, editionId }), outputTokens };
      }
      throw Object.assign(new Error('That prompt has no preview.'), { status: 404 });
    }
  }
}
// The trends-report request inputs from a sample: a recent report run's saved payload, else the sample's own posts.
function trendInput(sample, editionId) {
  if (sample.reportPayload) return { theme: sample.reportPayload.theme, selection: sample.reportPayload.selection, editionId, brandName: sample.reportPayload.brandName, analysisFocus: sample.reportPayload.analysisFocus, targetAudience: sample.reportPayload.targetAudience };
  const theme = sample.themes[0];
  return { theme, selection: reports().selectThemeEvidence({ theme, items: sample.posts, assignments: sample.assignments }), editionId, brandName: editionId === 'semrush' ? 'Semrush' : sample.brandKnowledge?.name || '', analysisFocus: editionId === 'semrush' ? 'SEO Trends' : sample.query || '', targetAudience: editionId === 'semrush' ? 'SEO Professionals' : sample.brandKnowledge?.audience || '' };
}

module.exports = { build, relatedIds, PICTURE_USD };
