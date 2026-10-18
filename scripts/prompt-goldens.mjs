// Golden prompts: renders every prompt builder with the frozen inputs in test/fixtures/prompts/inputs.json and writes
// each result to test/fixtures/prompts/<case>.txt. With no prompt overrides, a refactor must leave every one of them
// byte-identical, so after any change to a builder or to src/shared/prompt-defaults.json run
//   node scripts/prompt-goldens.mjs --check            (exit 1 and list the differences)
//   node scripts/prompt-goldens.mjs --check --only research.   (only cases whose id starts with research.)
//   node scripts/prompt-goldens.mjs [--only <prefix>]  (write: only for an intended prompt change, reviewed in the diff)
// test/prompt-golden.test.js runs the same comparison. A build-time script: it calls no model and spends nothing.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'test', 'fixtures', 'prompts');
const load = (file) => require(path.join(root, file));

// The Ask AI prompt's PAGES, SPOTS and APP GUIDE come from data files other people edit (help-spots.json, the guide),
// not from prompt text, so the golden keeps everything around them and marks where they go.
const HELP_DATA = '\n[PAGES, SPOTS and APP GUIDE: filled from help-spots.json and docs/app-guide.md]\n';
const helpText = ({ prefix, body }) => `${prefix.split('\nPAGES: ')[0]}${HELP_DATA}${body}`;
const joinParts = (parts) => parts.map(([name, text]) => `===== ${name} =====\n${text}`).join('\n\n');

export function goldenCases() {
  const input = JSON.parse(fs.readFileSync(path.join(dir, 'inputs.json'), 'utf8'));
  const research = load('src/shared/research-program.js');
  const prompts = load('src/shared/research-prompts.js');
  const reports = load('src/shared/research-reports.js');
  const content = load('src/shared/content-studio.js');
  const kit = load('src/shared/asset-kit.js');
  const findings = load('src/shared/findings-chat.js');
  const data = load('src/shared/data-prompts.js');
  const help = load('src/main/help-assistant.js');
  const presets = load('src/shared/report-presets.json');
  const { CLAUDE_SYSTEM_PROMPT } = load('src/shared/claude-runner.js');
  const posts = input.posts;
  const batch = (platform) => ({ id: `batch-${platform}`, runId: input.runId, platform, platformBatchNumber: 1, items: posts.filter((post) => post.platform === platform), evidenceIds: posts.filter((post) => post.platform === platform).map((post) => post.id) });
  const editions = { semrush: { editionId: 'semrush', brandName: 'Semrush' }, general: { editionId: 'general', brandName: 'Northwind Analytics' }, unnamed: { editionId: 'general', brandName: '' } };
  const cases = [];
  const add = (id, render) => cases.push({ id, render });

  // ── Research stages (research-prompts.js) ──
  for (const [name, edition] of Object.entries(editions)) {
    add(`research.discovery.${name}`, () => prompts.discoveryPrompt({ batch: batch('x'), query: '', ...edition }));
    add(`research.synthesis.${name}`, () => prompts.synthesisPrompt({ candidates: input.candidates, totalPosts: posts.length, sources: { Twitter: 3, LinkedIn: 3, Reddit: 2 }, maxThemes: 4, taxonomy: null, query: '', ...edition }));
    add(`research.matching.${name}`, () => prompts.matchingPrompt({ themes: input.themes, existing: input.existingThemes, ...edition }));
    add(`research.tagging.${name}`, () => prompts.taggingPrompt({ batch: batch('linkedin'), themes: input.themes, ...edition }));
  }
  add('research.discovery.semrush-focus-reddit', () => prompts.discoveryPrompt({ batch: batch('reddit'), query: 'AI answers and click loss', ...editions.semrush }));
  add('research.discovery.general-focus', () => prompts.discoveryPrompt({ batch: batch('linkedin'), query: 'Local search changes', ...editions.general, focus: 'local search and reviews' }));
  add('research.synthesis.semrush-taxonomy-focus', () => prompts.synthesisPrompt({ candidates: input.candidates, totalPosts: posts.length, sources: { Twitter: 3 }, maxThemes: 6, taxonomy: input.taxonomy, query: 'AI answers', ...editions.semrush }));
  add('research.synthesis.general-taxonomy', () => prompts.synthesisPrompt({ candidates: input.candidates, totalPosts: posts.length, sources: {}, maxThemes: 2, taxonomy: input.taxonomy, query: '', ...editions.general, focus: 'local search and reviews' }));
  add('research.matching.general-focus', () => prompts.matchingPrompt({ themes: input.themes, existing: [], ...editions.general, focus: 'local search and reviews' }));
  add('research.tagging.general-focus', () => prompts.taggingPrompt({ batch: batch('x'), themes: input.themes.slice(0, 1), ...editions.general, focus: 'local search and reviews' }));
  // Notes for the AI (a research program's notes, workflows and playbooks): added after the instructions only when set.
  const NOTES = 'Prefer data-backed, counter-intuitive findings a journalist would cover.';
  add('research.discovery.semrush-team-notes', () => prompts.discoveryPrompt({ batch: batch('x'), query: '', ...editions.semrush, notes: NOTES }));
  add('research.synthesis.general-team-notes', () => prompts.synthesisPrompt({ candidates: input.candidates, totalPosts: posts.length, sources: { Twitter: 3 }, maxThemes: 3, taxonomy: null, query: '', ...editions.general, notes: NOTES }));
  add('system.repair.with-previous', () => prompts.repairInstruction(new Error('candidates.0.painPoint: Invalid painPoint.'), { candidates: [{ name: 'Example' }] }));
  add('system.repair.no-previous', () => prompts.repairInstruction('The draft broke 2 rules.', undefined));

  // ── Golden Thread reports (research-reports.js) ──
  const theme = input.themes[0];
  const selection = () => reports.selectThemeEvidence({ theme, items: posts, assignments: input.assignments });
  const trendRequest = (edition, extra = {}) => reports.buildTrendReportRequest({ theme, selection: selection(), ...edition, ...extra });
  add('reports.trends-report.semrush', () => trendRequest({ editionId: 'semrush', brandName: 'Semrush', analysisFocus: 'SEO Trends', targetAudience: 'SEO Professionals' }).prompt);
  add('reports.trends-report.general', () => trendRequest({ editionId: 'general', brandName: 'Northwind Analytics', analysisFocus: 'AI search', targetAudience: 'marketing leads' }).prompt);
  add('reports.trends-report.general-bare', () => trendRequest({ editionId: 'general' }).prompt);
  add('reports.trends-report.semrush-team-notes', () => trendRequest({ editionId: 'semrush', brandName: 'Semrush', analysisFocus: 'SEO Trends', targetAudience: 'SEO Professionals', notes: 'Lead with what changed and how it compares to Semrush; no roadmap speculation.' }).prompt);
  // ── Quick scan trends report (research-scan-report.js): the frozen posts and trends as a scan's payload ──
  const scanReport = load('src/shared/research-scan-report.js');
  const scanPayload = () => scanReport.samplePayload({ ...input, query: 'AI answers and click loss' });
  add('reports.quick-scan.semrush', () => scanReport.buildScanReportRequest({ ...scanPayload(), editionId: 'semrush', brandName: 'Semrush' }).prompt);
  add('reports.quick-scan.general', () => scanReport.buildScanReportRequest({ ...scanPayload(), editionId: 'general', brandName: 'Northwind Analytics', audience: 'marketing leads' }).prompt);
  add('reports.quick-scan.general-bare', () => scanReport.buildScanReportRequest({ ...scanPayload(), editionId: 'general' }).prompt);
  const trendReport = () => { const request = trendRequest({ editionId: 'semrush' }); return reports.validateTrendReport(input.trendReportOutput, request.context); };
  const selfServeOnly = input.products.filter((product) => product.segment === 'self-serve');
  const enterpriseOnly = input.products.filter((product) => product.segment === 'enterprise');
  const toolkit = (edition, extra) => reports.buildToolkitRequest({ theme, trendReport: trendReport(), metrics: selection().metrics, editionId: edition, brandName: edition === 'semrush' ? 'Semrush' : 'Northwind Analytics', ...extra }).prompt;
  for (const edition of ['semrush', 'general']) {
    add(`reports.editorial-toolkit.${edition}-registry`, () => toolkit(edition, { registryText: input.registryText, enterpriseProducts: input.enterpriseProducts, referenceDocs: input.referenceDocs, trendsDocUrl: 'https://docs.example.com/trends/1' }));
    add(`reports.editorial-toolkit.${edition}-no-registry`, () => toolkit(edition, {}));
    add(`reports.editorial-toolkit.${edition}-enterprise-only`, () => toolkit(edition, { products: enterpriseOnly, enterpriseProducts: input.enterpriseProducts }));
    add(`reports.editorial-toolkit.${edition}-self-serve-only`, () => toolkit(edition, { products: selfServeOnly, referenceDocs: input.referenceDocs.slice(0, 2) }));
  }
  add('reports.editorial-toolkit.semrush-team-notes', () => toolkit('semrush', { notes: 'Lead with what changed and how it compares to Semrush; no roadmap speculation.' }));

  // ── Channel assets and pictures (content-studio.js, asset-kit.js) ──
  const planInput = (editionId) => ({ editionId, source: input.source, brandKnowledge: editionId === 'semrush' ? { ...input.brandKnowledge, name: 'Semrush' } : input.brandKnowledge, productRegistry: input.products, deliverableIds: content.CONTENT_DELIVERABLES.filter((d) => !d.kitOnly && (!d.editions || d.editions.includes(editionId))).map((d) => d.id), imageVariants: 3 });
  for (const editionId of ['semrush', 'general']) {
    add(`assets.content-plan.${editionId}`, () => joinParts(content.buildContentPlan(planInput(editionId)).deliverables.flatMap((d) => (d.kind === 'image' ? [[d.id, d.prompt], ...d.variantPrompts.map((text, i) => [`${d.id} variation ${i + 1}`, text])] : [[d.id, d.prompt]]))));
    add(`pictures.direction.${editionId}`, () => joinParts([['brand', content.brandImageDirection(editionId)], ['search-engine-land', content.brandImageDirection(editionId, { searchEngineLand: true })]]));
    // The short social video's plan and the prompt the video model receives (Video group).
    const video = () => content.buildContentPlan({ ...planInput(editionId), deliverableIds: ['social-video'] }).deliverables[0];
    add(`video.brief.${editionId}`, () => kit.videoBriefRequest(video(), planInput(editionId)).prompt);
    add(`video.clip.${editionId}`, () => kit.kitVideoDeliverable(video(), kit.validateVideoBrief({ title: 'Answers move above the links', prompt: 'A marketer at a bright desk scrolls a results page while answer panels slide into view above the links. The camera pushes in slowly, soft daylight.', onScreenText: ['Answers now sit above the links'], keyframePrompt: 'A marketer at a bright desk looking at a laptop.', avoid: ['Real brand logos'], evidenceIds: ['E1'] }, { evidenceIds: ['E1', 'E2'] }), { editionId }).prompt);
  }
  const imagePlan = (editionId, id) => content.buildContentPlan({ ...planInput(editionId), deliverableIds: [id] }).deliverables[0];
  const references = { none: [], style: [{ role: 'style' }, { role: 'style' }], 'style-logo': [{ role: 'style' }, { role: 'logo' }, { role: 'style' }, { role: 'style' }], 'one-style-logo': [{ role: 'style' }, { role: 'logo' }] };
  for (const [name, refs] of Object.entries(references)) {
    for (const [editionId, id] of [['semrush', 'brand-image'], ['general', 'brand-image'], ['semrush', 'sel-image'], ['semrush', 'sel-social-image']]) {
      const deliverable = () => imagePlan(editionId, id);
      const kitInput = { editionId, source: input.source, brandKnowledge: editionId === 'semrush' ? { ...input.brandKnowledge, name: 'Semrush' } : input.brandKnowledge };
      add(`pictures.kit-brief.${editionId}-${id}-${name}`, () => kit.imageBriefRequest(deliverable(), kitInput, { references: refs }).prompt);
      add(`pictures.kit-image.${editionId}-${id}-${name}`, () => { const picture = kit.kitImageDeliverable(deliverable(), kit.validateImageBrief(input.brief, { evidenceIds: ['E1', 'E2'] }), { editionId, label: 'Hero', references: refs }); return joinParts([['prompt', picture.prompt], ...picture.variantPrompts.map((text, i) => [`variation ${i + 1}`, text])]); });
    }
  }
  add('pictures.kit-image.general-no-subtitle', () => kit.kitImageDeliverable(imagePlan('general', 'brand-image'), { headline: 'Rankings hold while clicks fall', subtitle: '', callouts: [], visualIdea: 'A quiet harbor.', symbols: [], avoid: [] }, { editionId: 'general', references: [] }).variantPrompts.join('\n---\n'));

  // ── Ask your datasets (findings-chat.js) ──
  const dataset = { ...input.dataset };
  add('assistant.ask-datasets.plain', () => findings.buildFindingsContext({ datasets: [{ dataset, items: input.datasetItems }], messages: input.messages, question: 'What are people saying about AI answers?' }).prompt);
  add('assistant.ask-datasets.collection-settings', () => findings.buildFindingsContext({ datasets: [{ dataset: { ...dataset, searchContext: input.datasetSearchContext }, items: input.datasetItems }, { dataset: { id: 'dataset-two', name: 'Second sample', platform: 'linkedin' }, items: [] }], messages: [], question: 'Summarize the sample.', maxChars: 20000 }).prompt);

  // ── Ask AI (help-assistant.js; refactored in a later phase) ──
  const helpVariants = {
    'admin-simple': { role: 'admin', layout: 'simple' }, 'admin-classic': { role: 'admin', layout: 'classic' },
    'editor-simple': { role: 'editor', layout: 'simple' }, 'editor-classic': { role: 'editor', layout: 'classic' },
  };
  for (const [name, { role, layout }] of Object.entries(helpVariants)) {
    const context = { ...input.helpContext, role, layout };
    add(`assistant.ask-ai.${name}`, () => helpText(help.helpPromptParts({ question: 'What is rising this week?', history: [], context, guide: 'GUIDE', role })));
    add(`assistant.ask-ai.${name}-lookups-memory`, () => helpText(help.helpPromptParts({ question: 'What does the report say?', history: input.helpHistory, context, guide: 'GUIDE', lookups: input.helpLookups, role, memory: input.helpMemory, summary: 'They asked about trends earlier.', pending: input.helpPending })));
  }

  // ── Data tools (data-prompts.js) ──
  for (const preset of presets) add(`data.report-preset.${preset.id}`, () => data.datasetPrompt('report', 'the SOURCE_ITEMS section below', { reportPresetId: preset.id }));
  add('data.dataset-report.unknown-preset', () => data.datasetPrompt('report', 'the SOURCE_ITEMS section below', { reportPresetId: 'not-a-preset' }));
  add('data.dataset-report.context-path', () => data.datasetPrompt('report', '/tmp/items.jsonl', { contextPath: '/tmp/context.json', reportPresetId: 'subreddit-pulse' }));
  add('data.tag-items', () => data.datasetPrompt('tag', 'the SOURCE_ITEMS section below'));
  // A workflow's assets step with notes for the writers (team notes): one written asset.
  add('assets.newsletter.semrush-team-notes', () => content.buildContentPlan({ ...planInput('semrush'), deliverableIds: ['newsletter'], teamNotes: 'Lead with the numbers. Keep it under 300 words.' }).deliverables[0].prompt);
  add('data.threads', () => data.datasetPrompt('thread', 'the SOURCE_ITEMS section below', { contextPath: '/tmp/context.json' }));
  add('data.analysis-rules', () => JSON.stringify(data.analysisRules()));
  add('data.workflow-asset-pack', () => data.assetPackPrompt(JSON.stringify(input.assetPackContext, null, 2)));

  // ── Behind every call (view-only) ──
  add('system.claude', () => CLAUDE_SYSTEM_PROMPT);
  add('system.codex-wrapper', () => data.codexWrapper('/tmp/run/ai-input.txt'));
  return cases;
}

export function renderGoldens({ only = '' } = {}) {
  return goldenCases().filter((entry) => !only || entry.id.startsWith(only)).map((entry) => {
    const text = entry.render();
    if (typeof text !== 'string' || !text) throw new Error(`Golden case ${entry.id} rendered no text.`);
    return { id: entry.id, file: path.join(dir, `${entry.id}.txt`), text };
  });
}

// Every difference between the rendered prompts and the saved goldens: missing files and the first differing line.
export function compareGoldens({ only = '' } = {}) {
  const differences = [];
  for (const { id, file, text } of renderGoldens({ only })) {
    if (!fs.existsSync(file)) { differences.push({ id, message: 'no golden file yet' }); continue; }
    const saved = fs.readFileSync(file, 'utf8');
    if (saved.replace(/\r\n/g, '\n') === text) continue; // a checkout made with core.autocrlf still matches
    const a = saved.split('\n'); const b = text.split('\n'); let line = 0;
    while (line < Math.max(a.length, b.length) && a[line] === b[line]) line++;
    differences.push({ id, message: `line ${line + 1} differs`, saved: (a[line] ?? '(end of file)').slice(0, 240), rendered: (b[line] ?? '(end of file)').slice(0, 240) });
  }
  return differences;
}

function main(argv) {
  const check = argv.includes('--check'); const at = argv.indexOf('--only'); const only = at >= 0 ? argv[at + 1] || '' : '';
  if (check) {
    const differences = compareGoldens({ only });
    const count = renderGoldens({ only }).length;
    if (!differences.length) { console.log(`prompt goldens: ${count} cases, 0 differences.`); return 0; }
    for (const difference of differences) console.log(`✗ ${difference.id}: ${difference.message}${difference.saved !== undefined ? `\n    saved:    ${difference.saved}\n    rendered: ${difference.rendered}` : ''}`);
    console.log(`prompt goldens: ${differences.length} of ${count} cases differ.`);
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true }); let written = 0;
  for (const { file, text } of renderGoldens({ only })) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { fs.writeFileSync(file, text); written++; } }
  console.log(`prompt goldens: wrote ${written} file${written === 1 ? '' : 's'}.`);
  return 0;
}

// Run as a script, not imported by a test. Both sides are real paths, so a symlinked checkout, a junction or a subst drive
// still counts (Node runs the real file), and path.relative ignores drive-letter case on Windows.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return path.relative(fs.realpathSync(fileURLToPath(import.meta.url)), fs.realpathSync(path.resolve(process.argv[1]))) === ''; } catch (_) { return false; }
}
if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
