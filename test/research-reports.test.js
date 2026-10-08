import { describe, expect, it } from 'vitest';
const reports = require('../src/shared/research-reports');
const studio = require('../src/shared/content-studio');
const { safeGoogleDocHtml } = require('../src/main/google-delivery');
const {
  TREND_REPORT_LAYOUT, TOOLKIT_LAYOUT, N8N_METHOD_NOTE, AFFILIATE_SAFE_LINE, parseToolkitRegistry, registryTextFromProducts, selectThemeEvidence,
  buildTrendReportRequest, validateTrendReport, renderTrendReport, buildToolkitRequest, validateToolkit, renderToolkit,
} = reports;

// Synthetic registry in the n8n registry text format: two self-serve toolkits, one Enterprise product, one umbrella entry.
const REGISTRY = `Fixture Toolkit Registry

Semrush One Rule: Semrush One is an umbrella plan and is never recommended directly.

1. SEO Toolkit

URL: https://www.example.com/seo/

The SEO Toolkit is a fixture toolkit for keyword research, site audits and content planning work.

Research

Tool Name | Core Function | Key Tags
Keyword Magic Tool | Builds keyword lists from a seed term | keywords, volume
Site Audit | Crawls a site and lists technical issues | crawl, health
Topic Research | Finds subtopics, questions and headlines | topics, questions
SEO Writing Assistant | Scores drafts while you write | readability

Tool URLs: Keyword Magic Tool: example.com/seo/kmt/ | Site Audit: www.example.com/seo/audit/

2. AI Visibility Toolkit

URL: https://www.example.com/ai/

The AI Visibility Toolkit is a fixture toolkit that tracks how a brand appears inside AI answers.

Reports

Tool Name | Core Function | Key Tags
Visibility | AI visibility over time | trend_lines
Citations | Sources cited in AI answers | citations
Prompt Research | Finds audience prompts by topic | prompts
Prompt Tracking | Tracks chosen prompts daily | tracking
Brand Performance | Brand prominence in AI answers | prominence

Tool URLs: Prompt Research: example.com/ai/prompts/

Semrush One (umbrella plan — reference only)

URL: https://www.example.com/one/

Semrush One bundles the fixture toolkits under a single plan and is never a product.

Tool Name | Core Function | Key Tags
Bundle Seat | Must never be parsed as a tool | none

3. Enterprise Toolkits

ENTERPRISE SEGMENT (not affiliate-promotable)

Enterprise AIO (AI Optimization)

URL: https://www.example.com/enterprise-aio/

A fixture enterprise product that extends AI visibility reporting across many brands and markets.

Tool Name | Core Function | Key Tags
Enterprise AIO | Multi-brand AI visibility reporting | governance
Shopping Shelf Tracking | AI shopping shelf monitoring | shopping

Enterprise AIO — Key Capabilities

Governed reporting for leadership
Multi-market rollups
`;
const ENTERPRISE = ['Enterprise AIO'];
const theme = { id: 'theme-ai', name: 'AI Answer Click Erosion', description: 'Practitioners report fewer clicks when AI answers resolve informational queries.', matchingKeywords: ['ai answers', 'zero click'], matchingCriteria: 'Posts describing measured click loss from AI answers.', negativeCriteria: 'Generic AI hype.', novelty: 'NEW ANGLE', taxonomyCategory: 'AI Search' };
const EMPTY_METRICS = { likes: null, comments: null, shares: null, views: null, quotes: null, bookmarks: null, upvotes: null, upvoteRatio: null };
const post = (id, platform, author, text, metrics = {}, extra = {}) => ({ id, runId: 'run-a', platform, type: 'post', author, authorName: '', text, url: `https://example.com/${platform}/${id}`, publishedAt: '2026-09-22T12:00:00.000Z', dateKnown: true, metrics: { ...EMPTY_METRICS, ...metrics }, engagement: { value: extra.prevalence ?? 10 }, title: '', community: platform === 'reddit' ? 'SEO' : '', ...extra });
const assign = (item, extra = {}) => ({ runId: 'run-a', itemId: item.id, themeId: 'theme-ai', suggestedThemeId: 'theme-ai', confidence: 0.8, status: 'accepted', reason: 'Describes click loss from AI answers.', painPoint: 'Loss of Traffic/Visibility', urgency: 'Strategic Planning', entities: { tools: ['AI Overviews'], people: [], companies: ['Google'] }, ...extra });

const x1 = post('x1', 'x', 'search_pat', 'Our help-center articles still rank, but AI answers now resolve the question first. Organic click-through on those pages is down 41% this quarter.', { likes: 22, shares: 3, comments: 7, views: 1200, quotes: 1, bookmarks: 2 }, { prevalence: 61.5 });
const x2 = post('x2', 'x', 'search_pat', 'Holding the first organic slot used to guarantee visits; with an AI summary above it, our glossary page lost half its sessions.', { likes: 9, shares: 1, comments: 2, views: 400, quotes: 0, bookmarks: 0 }, { prevalence: 40.2 });
const x3 = post('x3', 'x', 'answer_dev', 'Winning the answer box now means winning attention without winning the visit.', { likes: 13, shares: 0, comments: 2, views: 900, quotes: 0, bookmarks: 1 }, { prevalence: 45, publishedAt: '2026-09-20T08:00:00.000Z' });
const li1 = post('li1', 'linkedin', 'pat-rivera-seo', 'Our recipe site saw AI summaries appear on simple how-to searches this month. Plan for fewer visits on explainer content, even without a formal announcement.', { likes: 77, comments: 12, shares: 3 }, { prevalence: 70.1 });
const li2 = post('li2', 'linkedin', 'jordan-lee-test', "Personalized AI answers make today's ranking reports misleading for every reader. Plan for the interface change, not just the ranking change.", { likes: 89, comments: 30 }, { prevalence: 72 });
const li3 = post('li3', 'linkedin', 'sam-calc-test', 'A search for a mortgage calculator returned a working calculator inside the AI answer. Our lead-gen calculator page has nothing left to offer that visit.', { likes: 8, comments: 5 }, { prevalence: 33 });
const rd1 = post('rd1', 'reddit', 'ctr_watcher', 'Explainer CTR dropped\nOur explainer pages now get about 1 percent CTR since AI answers rolled out. What are you changing?', { upvotes: 12, comments: 27, upvoteRatio: 0.92 }, { prevalence: 30, title: 'Explainer CTR dropped' });
const rd2 = post('rd2', 'reddit', 'indie_builder', 'My hobby site went from 80 clicks a day to 6 after AI answers started covering the topic.', { upvotes: 16, comments: 31, upvoteRatio: 0.88 }, { prevalence: 35 });
const rejected = post('x4', 'x', 'noise', 'An unrelated post about conference snacks and travel plans this week.');
const otherTheme = post('li4', 'linkedin', 'other-author', 'A post that belongs to a different theme about local listings.');
const ITEMS = [x1, x2, x3, li1, li2, li3, rd1, rd2, rejected, otherTheme];
const ASSIGNMENTS = [assign(x1), assign(x2), assign(x3, { painPoint: 'Proving ROI/Attribution', urgency: 'Immediate Crisis', entities: { tools: ['Search Console'], people: ['Pat Example'], companies: [] } }), assign(li1), assign(li2), assign(li3, { status: 'needs-review', confidence: 0.6, painPoint: 'Platform Frustration', reason: 'Calculator tools replaced by AI answers. [MEDIUM CONFIDENCE - FLAGGED FOR REVIEW]' }), assign(rd1), assign(rd2), assign(rejected, { themeId: null, status: 'rejected', confidence: 0.2 }), assign(otherTheme, { themeId: 'theme-other', suggestedThemeId: 'theme-other' })];
const selection = () => selectThemeEvidence({ theme, items: ITEMS, assignments: ASSIGNMENTS });
const trendRequest = (extra = {}) => buildTrendReportRequest({ theme, selection: selection(), editionId: 'semrush', ...extra });
const goodReport = (changes = {}) => ({
  executiveSummary: 'Across 8 practitioner posts, AI answers are absorbing informational clicks and practitioners cannot measure the loss.',
  trendSummary: 'Loss of traffic dominates the signals (6 of 8 posts) as AI answers resolve informational queries before a click.',
  quotes: [
    { evidenceId: 'x1', text: 'AI answers now resolve the question first. Organic click-through on those pages is down 41% this quarter.' },
    { evidenceId: 'x3', text: '"Winning the answer box now means winning attention without winning the visit."' },
    { evidenceId: 'li1', text: 'Our recipe site saw AI summaries appear on simple   how-to searches this month.' },
    { evidenceId: 'li2', text: 'Plan for the interface change, not just the ranking change.' },
  ],
  evidenceLinks: [
    { evidenceId: 'rd1', description: 'Explainer CTR fell to about 1% after AI answers rolled out' },
    { evidenceId: 'rd2', description: 'Hobby site traffic dropped from 80 clicks a day to 6' },
    { evidenceId: 'x2', description: 'First organic slot still lost half its sessions' },
    { evidenceId: 'x1', description: 'Click-through down 41% on help-center pages' },
    { evidenceId: 'li3', description: 'AI answers now include working calculators' },
    { evidenceId: 'li2', description: 'Personalized AI answers make ranking reports misleading' },
  ],
  painPoints: [
    { label: 'Loss of Traffic/Visibility', postCount: 6, text: 'Click-through rates on informational pages fell sharply, even at position one.' },
    { label: 'Proving ROI/Attribution', postCount: 1, text: 'Teams cannot attribute exposure inside AI answers.' },
    { label: 'Platform Frustration', postCount: 1, text: 'Calculators built for leads lost their purpose.' },
  ],
  opportunities: [{ label: 'Intent-tiered content', text: 'Shift effort to queries that still send clicks.' }, { label: 'AI answer measurement', text: 'Track presence inside AI answers.' }, { label: 'Owned audiences', text: 'Build direct demand that search cannot remove.' }],
  technicalDetails: { tools: 'AI Overviews (6), Search Console (1)', companies: 'Google (7)', developments: 'AI answers that generate interactive tools on the fly.' },
  topPerformingContent: { highestEngagementEvidenceId: 'li2', highestEngagementNote: 'It drew the most comments in the set', mostDiscussedTopic: 'Informational click loss — 6 mentions', mostRequestedFeature: 'Click data for AI answers — 2 times' },
  keyTakeaways: ['AI answers are the default for informational searches.', 'Click loss concentrates in informational intent.', 'Measurement is the second problem.'],
  caveats: [],
  ...changes,
});
const validReport = (changes, extra) => { const request = trendRequest(extra); return validateTrendReport(goodReport(changes), request.context); };

const products = () => parseToolkitRegistry(REGISTRY, { enterpriseProducts: ENTERPRISE }).products;
const toolkitRequest = (extra = {}) => buildToolkitRequest({ theme, trendReport: validReport(), registryText: REGISTRY, enterpriseProducts: ENTERPRISE, editionId: 'semrush', trendsDocUrl: 'https://docs.example.com/trends/1', referenceDocs: [{ kind: 'icp', title: 'ICP', text: 'Fixture ICP: in-house search leads at mid-market companies.' }, { kind: 'positioning', title: 'Positioning', text: 'Fixture positioning notes for the brand voice.' }, { kind: 'ai-visibility', title: 'Glossary', text: 'Fixture AI search glossary for vocabulary.' }, { kind: 'other', title: 'Launch calendar', text: 'Fixture launch calendar for the quarter.' }], ...extra });
const goodToolkit = (changes = {}) => ({
  trendName: 'AI Answer Click Erosion',
  whatHappened: 'AI answers now resolve informational searches before anyone clicks, and practitioners report click-through declines of up to 41% on informational pages.',
  whyMatters: { intro: 'Your informational traffic is now a measurement problem as much as a ranking problem.', painPoints: [{ label: 'Click loss', text: 'Informational pages lose clicks even at position one.' }, { label: 'Attribution gaps', text: 'Exposure inside AI answers is invisible in analytics.' }, { label: 'Lost lead magnets', text: 'Calculators built for leads lost their reason to exist.' }] },
  howToTalk: { intro: 'Start from the practitioner reality: the click is optional now.', talkingPoints: [{ label: 'Citation Economics', text: 'Being cited is the new click.' }, { label: 'The Grounding Gap', text: 'AI answers ground on sources you can influence.' }, { label: 'Budget Justification', text: 'Reporting needs a metric that survives zero-click results.' }] },
  enterpriseAngle: { productId: 'enterprise-aio', paragraph: 'Large brands need governed reporting on how AI answers present every brand and market.', capabilities: [{ name: 'Multi-brand AI visibility reporting', text: 'Rolls brand presence up for leadership.' }, { name: 'Shopping Shelf Tracking', text: 'Shows where products appear in AI shopping answers.' }, { name: 'Governed reporting for leadership', text: 'Turns AI answer presence into a recurring report.' }] },
  selfServeAngle: { productId: 'ai-visibility-toolkit', paragraph: 'Small teams need to see where AI answers cite them and which prompts matter.', keyTools: [{ toolName: 'Visibility', text: 'Trends presence in AI answers over time.' }, { toolName: '**Citations report**', text: 'Shows which pages AI answers cite.' }, { toolName: 'Prompt Research tool', text: 'Finds the prompts buyers ask.' }], alsoFits: { productId: 'seo-toolkit', toolNames: ['Topic Finder'], text: 'Topic Finder surfaces the questions to answer on pages AI answers cite.' } },
  headlines: ['Informational CTR fell 41% when AI answers kept the visit', 'Position one no longer guarantees the click', 'Your visibility moved into AI answers', 'Half the traffic, same ranking', 'The click is optional now'],
  subheads: ['Measure presence where the answer happens', 'Rankings hold while clicks fall', 'Reporting has to follow the answer', 'Intent decides which pages still earn visits', 'Owned demand is the hedge'],
  hooks: ['"Winning the answer box now means winning attention without winning the visit."', 'Explainer CTR now sits near 1% for some sites.', 'A calculator inside the answer replaced a lead magnet.', 'Your best page may be cited and never visited.', 'Traffic fell from 80 clicks a day to 6.'],
  ctas: { enterprise: ['Report AI answer presence across every brand and market.', '[ENT] Give leadership a governed view of AI shopping shelves.'], plg: ['Track the prompts that matter to your category daily.', 'See which of your pages AI answers cite.', 'Find the questions buyers ask AI tools.'] },
  caveats: [],
  ...changes,
});
const withSelfServe = (changes) => goodToolkit({ selfServeAngle: { ...goodToolkit().selfServeAngle, ...changes } });
function schemaIsStrict(schema, path = 'schema') {
  if (schema.type === 'object') {
    expect(schema.additionalProperties, path).toBe(false);
    expect([...schema.required].sort(), path).toEqual(Object.keys(schema.properties).sort());
    for (const [key, value] of Object.entries(schema.properties)) schemaIsStrict(value, `${path}.${key}`);
  }
  if (schema.type === 'array') schemaIsStrict(schema.items, `${path}[]`);
}

describe('registry parsing', () => {
  it('reads toolkits, segments, tool tables and tool URLs, and skips the umbrella plan', () => {
    const { products: list, toolkits, warnings } = parseToolkitRegistry(REGISTRY, { enterpriseProducts: ENTERPRISE });
    expect(warnings).toEqual([]);
    expect(list.map(p => [p.id, p.name, p.segment, p.affiliateEligible])).toEqual([['seo-toolkit', 'SEO Toolkit', 'self-serve', true], ['ai-visibility-toolkit', 'AI Visibility Toolkit', 'self-serve', true], ['enterprise-aio', 'Enterprise AIO', 'enterprise', false]]);
    const [seo, ai, enterprise] = list;
    expect(seo.tools.map(t => t.name)).toEqual(['Keyword Magic Tool', 'Site Audit', 'Topic Research', 'SEO Writing Assistant']);
    expect(seo.tools.find(t => t.name === 'Keyword Magic Tool').url).toBe('https://www.example.com/seo/kmt/');
    expect(seo.tools.find(t => t.name === 'Site Audit').url).toBe('https://www.example.com/seo/audit/');
    expect(ai.tools.find(t => t.name === 'Prompt Research').url).toBe('https://www.example.com/ai/prompts/');
    expect(seo.description).toContain('fixture toolkit for keyword research');
    expect(enterprise.url).toBe('https://www.example.com/enterprise-aio/');
    expect(enterprise.capabilities).toEqual(['Enterprise AIO — Multi-brand AI visibility reporting', 'Shopping Shelf Tracking — AI shopping shelf monitoring', 'Governed reporting for leadership', 'Multi-market rollups']);
    expect(enterprise.tools.map(t => t.name)).toEqual(['Enterprise AIO', 'Shopping Shelf Tracking']);
    expect(JSON.stringify(list)).not.toMatch(/Semrush One|Bundle Seat|example\.com\/one/);
    expect(toolkits).toEqual({ 'seo toolkit': ['keyword magic tool', 'site audit', 'topic research', 'seo writing assistant'], 'ai visibility toolkit': ['visibility', 'citations', 'prompt research', 'prompt tracking', 'brand performance'] });
    expect(studio.validateProductRegistry(list, { editionId: 'semrush' })).toHaveLength(3);
    expect(studio.validateProductRegistry(list, { editionId: 'general' })).toHaveLength(3);
  });
  it('keeps Enterprise-section entries out of the self-serve segment and warns about gaps', () => {
    const unlisted = parseToolkitRegistry(REGISTRY);
    expect(unlisted.products.find(p => p.name === 'Enterprise AIO (AI Optimization)')).toMatchObject({ segment: 'enterprise', affiliateEligible: false });
    expect(unlisted.warnings.join(' ')).toContain('not in the configured Enterprise product list');
    expect(parseToolkitRegistry(REGISTRY, { enterpriseProducts: ['Enterprise AIO', 'Enterprise Data'] }).warnings).toContain('Configured Enterprise product "Enterprise Data" was not found in the registry.');
    const flattened = parseToolkitRegistry('1. SEO Toolkit\nURL: https://www.example.com/seo/\nKeyword Magic Tool, Site Audit and Topic Research are the core tools of this fixture toolkit.');
    expect(flattened.warnings.join(' ')).toContain('Registry tool tables are missing');
    expect(flattened.products[0].tools).toEqual([]);
  });
  it('rebuilds a parseable registry text from structured products', () => {
    const rebuilt = parseToolkitRegistry(registryTextFromProducts(products()), { enterpriseProducts: ENTERPRISE });
    expect(rebuilt.toolkits).toEqual(parseToolkitRegistry(REGISTRY, { enterpriseProducts: ENTERPRISE }).toolkits);
    expect(rebuilt.products.map(p => [p.id, p.segment])).toEqual(products().map(p => [p.id, p.segment]));
  });
});

describe('theme evidence selection (Prepare Report Request4 port)', () => {
  it('matches accepted and needs-review assignments and sums n8n-shaped metrics', () => {
    const value = selection();
    expect(value.posts.map(p => p.id)).toEqual(['li2', 'li1', 'li3', 'x1', 'x3', 'x2', 'rd2', 'rd1']);
    expect(value.metrics.twitter).toEqual({ postCount: 3, totalLikes: 44, totalRetweets: 4, totalReplies: 11, totalViews: 2500, totalQuotes: 1, totalBookmarks: 3 });
    expect(value.metrics.linkedin).toEqual({ postCount: 3, totalReactions: 174, totalComments: 47, totalShares: 3, totalViews: 0 });
    expect(value.metrics.reddit).toEqual({ postCount: 2, totalUpvotes: 28, totalComments: 58, avgScore: 14, avgUpvoteRatio: 0.9 });
    expect(value.metrics.prevalence).toEqual({ x: 146.7, linkedin: 175.1, reddit: 65, overall: 386.8 });
    expect(value.signals.painPoints).toEqual([{ label: 'Loss of Traffic/Visibility', count: 6 }, { label: 'Platform Frustration', count: 1 }, { label: 'Proving ROI/Attribution', count: 1 }]);
    expect(value.signals.urgency).toEqual([{ label: 'Strategic Planning', count: 7 }, { label: 'Immediate Crisis', count: 1 }]);
    expect(value.signals.tools[0]).toEqual({ name: 'AI Overviews', count: 7 });
    expect(value.signals.companies).toEqual([{ name: 'Google', count: 7 }]);
    expect(value.signals.people).toEqual([{ name: 'Pat Example', count: 1 }]);
    expect(value.coverage).toMatchObject({ matchedCount: 8, selectedCount: 8, omittedCount: 0, missingPlatforms: [], needsReviewCount: 1 });
    expect(value.posts.find(p => p.id === 'x1')).toMatchObject({ platform: 'x', author: 'search_pat', date: '2026-09-22', rank: 0, fullText: true, truncated: false, prevalence: 61.5, engagementScore: 57, assignment: { status: 'accepted', confidence: 0.8 } });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(studio.validateAggregateMetrics(value.metrics)).toEqual(value.metrics);
  });
  it('allocates per platform, prefers new authors, then confidence and engagement', () => {
    const items = []; const assignments = [];
    const add = (id, platform, author, confidence, metrics = {}) => { const item = post(id, platform, author, `Fixture evidence ${id} about AI answers taking clicks.`, metrics); items.push(item); assignments.push(assign(item, { confidence })); };
    add('l1', 'linkedin', 'repeat', 0.99); add('l2', 'linkedin', 'repeat', 0.98); for (let i = 3; i <= 8; i++) add(`l${i}`, 'linkedin', `author-${i}`, 0.9 - i / 100);
    add('t1', 'x', 'a', 0.7, { likes: 1 }); add('t2', 'x', 'b', 0.7, { likes: 1, quotes: 2 }); add('t3', 'x', 'c', 0.7, { likes: 5 }); add('t4', 'x', 'd', 0.5, { likes: 100 });
    for (let i = 1; i <= 4; i++) add(`r${i}`, 'reddit', `r-author-${i}`, 0.8, { upvotes: i });
    const value = selectThemeEvidence({ theme, items, assignments, maxPosts: 8 });
    expect(value.posts.map(p => p.id)).toEqual(['l1', 'l3', 'l4', 'l5', 't2', 't3', 'r4', 'r3']);
    expect(value.coverage).toMatchObject({ matchedCount: 16, selectedCount: 8, omittedCount: 8, platforms: { linkedin: { matched: 8, selected: 4 }, x: { matched: 4, selected: 2 }, reddit: { matched: 4, selected: 2 } } });
    expect(value.metrics.linkedin.postCount).toBe(8);
    expect(value.metrics.twitter.totalLikes).toBe(107);
    const uneven = selectThemeEvidence({ theme, items: items.slice(0, 15), assignments, maxPosts: 7 });
    expect(uneven.posts).toHaveLength(7);
  });
  it('gives the top 30 posts per platform full text and truncates the rest at 1,200 characters', () => {
    const items = Array.from({ length: 32 }, (_, i) => post(`long-${i}`, 'linkedin', `writer-${i}`, `${String(i).padStart(2, '0')} ${'a'.repeat(3497)}`));
    const value = selectThemeEvidence({ theme, items, assignments: items.map((item, i) => assign(item, { confidence: 0.99 - i / 100 })) });
    expect(value.posts[0]).toMatchObject({ fullText: true, truncated: true, textLength: 3500 });
    expect(value.posts[29]).toMatchObject({ rank: 29, fullText: true });
    expect(value.posts[29].text).toHaveLength(3000);
    expect(value.posts[30]).toMatchObject({ rank: 30, fullText: false, truncated: true });
    expect(value.posts[30].text).toHaveLength(1200);
    const short = selectThemeEvidence({ theme, items: [post('short', 'linkedin', 'w', 'b'.repeat(1500))], assignments: [assign({ id: 'short' })] });
    expect(short.posts[0]).toMatchObject({ fullText: true, truncated: false });
  });
});

describe('comprehensive trends report', () => {
  it('builds the n8n prompt with pre-calculated metrics, signals, AI lines and evidence IDs', () => {
    const { prompt, schema, context } = trendRequest();
    // Posts are cited by short EVIDENCE_IDs (E1…, by position in the selection); raw IDs never appear.
    const ref = (id) => `E${context.selection.posts.findIndex((post) => post.id === id) + 1}`;
    expect(prompt.startsWith('SYSTEM INSTRUCTIONS\nYou are an expert marketing analyst creating a comprehensive trends report.\n\n## REPORT OUTPUT FORMAT')).toBe(true);
    for (const rule of ['6. NO Reddit quotes — Reddit only in evidence links and summaries', '7. URLs must be raw format (https://...) not markdown', 'weight these higher 10. BANNED PHRASES: Never use "flying blind", "blind spot", or "blind spots" anywhere in the report.', '[Include 6-9 quotes. Min 2 Twitter, 2 LinkedIn. NO Reddit quotes.]', '5. Top 30 posts have extended text']) expect(prompt).toContain(rule);
    expect(prompt).toContain('# TASK: Create Trends Report for: "AI Answer Click Erosion"\n\n## THEME CONTEXT\nPractitioners report fewer clicks when AI answers resolve informational queries.\nKeywords: ai answers, zero click\nMatch criteria: Posts describing measured click loss from AI answers.\nExclusions: Generic AI hype.');
    expect(prompt).toContain('**Twitter/X (3):** 4 RTs, 11 Replies, 44 Likes, 1 Quotes, 2,500 Views, 3 Bookmarks');
    expect(prompt).toContain('**Reddit (2):** 28 Upvotes, 58 Comments, Avg Score 14, Avg Ratio 0.90\n\n**Total: 8 posts**');
    expect(prompt).toContain('### Pain Points\n- Loss of Traffic/Visibility: 6 posts\n');
    expect(prompt).toContain('### Top Tools\n- AI Overviews: 7 mentions\n- Search Console: 1 mentions\n');
    expect(prompt).toContain(`EVIDENCE_ID: ${ref('x1')}\n"Our help-center articles still rank, but AI answers now resolve the question first. Organic click-through on those pages is down 41% this quarter."\n— @search_pat, 2026-09-22 — https://example.com/x/x1\nMetrics: 22 likes, 3 RTs, 7 replies, 1200 views, 1 quotes, 2 bookmarks, prevalence=61.5\nAI: Confidence: 0.8 — "Describes click loss from AI answers."\n  Analysis: Pain=Loss of Traffic/Visibility | Urgency=Strategic Planning | Entities=[AI Overviews, Google]`);
    expect(prompt).toContain('AI: Confidence: 0.6 — "Calculator tools replaced by AI answers."');
    expect(prompt).toContain('— u/ctr_watcher in r/SEO, 2026-09-22 — https://example.com/reddit/rd1\nMetrics: 12 upvotes, 27 comments, 0.92 ratio, prevalence=30');
    for (const item of [x1, x2, x3, li1, li2, li3, rd1, rd2]) expect(prompt).toContain(`EVIDENCE_ID: ${ref(item.id)}\n`);
    expect(prompt).not.toMatch(/EVIDENCE_ID: (x|li|rd)\d/); expect(context.selection.posts.some((post) => post.id === 'x4')).toBe(false);
    expect(prompt.indexOf('## LINKEDIN POSTS')).toBeLessThan(prompt.indexOf('## TWITTER/X POSTS'));
    expect(prompt.indexOf('## TWITTER/X POSTS')).toBeLessThan(prompt.indexOf('## REDDIT POSTS'));
    expect(prompt).toContain('Respond with JSON only, matching the supplied JSON schema. Do not write markdown.');
    schemaIsStrict(schema);
    expect(schema.properties.painPoints).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(schema.properties.painPoints.items.properties.postCount).toEqual({ type: 'integer' });
    expect(schema.properties.quotes.maxItems).toBe(9);
    expect(context).toMatchObject({ editionId: 'semrush', brandName: 'Semrush', theme: { id: 'theme-ai', name: 'AI Answer Click Erosion' } });
    const general = buildTrendReportRequest({ theme, selection: selection(), brandName: 'Fixture Co', analysisFocus: 'Search trends', targetAudience: 'in-house marketers' });
    expect(general.prompt).toContain('comprehensive trends report for Fixture Co (focus: Search trends), written for in-house marketers.');
    expect(general.prompt).not.toContain('Semrush');
    expect(() => buildTrendReportRequest({ theme, selection: { ...selection(), posts: [] } })).toThrow('no matched evidence');
  });
  it('accepts a grounded draft and takes quote and link metadata from the evidence records', () => {
    const output = validReport();
    expect(output).toMatchObject({ deliverableId: 'evidence-report', layout: TREND_REPORT_LAYOUT, editionId: 'semrush', title: 'AI Answer Click Erosion — Comprehensive Trends Report', theme: { id: 'theme-ai' } });
    expect(output.quotes[0]).toEqual({ evidenceId: 'x1', text: 'AI answers now resolve the question first. Organic click-through on those pages is down 41% this quarter.', author: 'search_pat', platform: 'x', date: '2026-09-22', url: 'https://example.com/x/x1', metricsLine: '22 likes, 7 replies' });
    expect(output.quotes[1].text).toBe('Winning the answer box now means winning attention without winning the visit.');
    expect(output.quotes[2].text).toBe('Our recipe site saw AI summaries appear on simple how-to searches this month.');
    expect(output.evidenceLinks[0]).toEqual({ evidenceId: 'rd1', description: 'Explainer CTR fell to about 1% after AI answers rolled out', platform: 'reddit', url: 'https://example.com/reddit/rd1', metricsLine: '12 upvotes, 27 comments' });
    expect(output.painPoints[0]).toMatchObject({ postCount: 6, percent: 75 });
    expect(output.topPerformingContent.post).toMatchObject({ platform: 'linkedin', author: 'jordan-lee-test', metricsLine: '89 reactions, 30 comments', prevalence: 72 });
    expect(output.aggregateMetrics.twitter.totalLikes).toBe(44);
    expect(output.warnings).toEqual(['Only 4 verified direct quotes (target 6–9).', 'Only 6 evidence links (target 8–10).']);
    expect(output.evidenceRegister.map(record => record.id)).toEqual(['x1', 'x3', 'li1', 'li2', 'rd1', 'rd2', 'x2', 'li3']);
    expect(output.evidenceRegister[0]).toMatchObject({ platform: 'x', author: 'search_pat', url: 'https://example.com/x/x1', excerptTruncated: false });
  });
  it('rejects fabricated, Reddit, duplicate and unknown quotes with model-actionable messages', () => {
    const quotes = goodReport().quotes;
    expect(() => validReport({ quotes: [...quotes, { evidenceId: 'x2', text: 'AI summaries destroyed all organic traffic.' }] })).toThrow('quotes[4] is not an exact excerpt of x2');
    expect(() => validReport({ quotes: [...quotes, { evidenceId: 'x2', text: 'Holding the first organic slot ... lost half its sessions.' }] })).toThrow('not an exact excerpt');
    expect(() => validReport({ quotes: [...quotes, { evidenceId: 'rd1', text: 'Explainer CTR dropped' }] })).toThrow('Direct quotes come from Twitter/X and LinkedIn only');
    expect(() => validReport({ quotes: [...quotes, { ...quotes[0] }] })).toThrow('repeats an earlier quote');
    // A citation of an ID that was not supplied (a mis-copied hex ID, say) is dropped with a warning, not fatal.
    const unknownQuote = validReport({ quotes: [...quotes, { evidenceId: 'x99', text: 'Anything' }] });
    expect(unknownQuote.quotes).toHaveLength(quotes.length); expect(unknownQuote.warnings.join(' ')).toContain('quotes[4].evidenceId cited "x99", which is not a supplied EVIDENCE_ID; it was dropped.');
    // Short EVIDENCE_IDs from the prompt resolve to the real evidence ID, case-insensitively.
    const posts = trendRequest().context.selection.posts; const ref = (id) => `e${posts.findIndex((post) => post.id === id) + 1}`;
    expect(validReport({ quotes: [{ evidenceId: ref('li2'), text: 'make today\u2019s ranking reports misleading' }] }).quotes[0]).toMatchObject({ evidenceId: 'li2', platform: 'linkedin' });
    // Whitespace, case, invisible characters and quote/dash style may differ; the stored quote is the source text.
    const styled = validReport({ quotes: [{ evidenceId: 'li2', text: 'make today\u2019s ranking reports misleading\u200b' }, { evidenceId: 'x1', text: '...ai answers now resolve the question first...' }] }).quotes;
    expect(styled.map(quote => quote.text)).toEqual(["make today's ranking reports misleading", '...AI answers now resolve the question first...']);
    expect(() => validReport({ quotes: [{ evidenceId: 'li2', text: 'Plan for the interface change' }, { evidenceId: 'li2', text: 'PLAN FOR THE INTERFACE CHANGE' }] })).toThrow('repeats an earlier quote');
    const unknownLink = validReport({ evidenceLinks: [{ evidenceId: 'invented', description: 'Made up' }] });
    expect(unknownLink.evidenceLinks).toEqual([]); expect(unknownLink.warnings.join(' ')).toContain('evidenceLinks[0].evidenceId cited "invented", which is not a supplied EVIDENCE_ID');
    let error;
    try { validReport({ painPoints: goodReport().painPoints.slice(0, 2), keyTakeaways: ['One'] }); } catch (caught) { error = caught; }
    expect(error.message).toContain('painPoints needs exactly 3 items (got 2)');
    expect(error.violations.map(v => v.field)).toEqual(['painPoints', 'keyTakeaways']);
    expect(error.field).toBe('painPoints');
    expect(() => validReport({ painPoints: [{ ...goodReport().painPoints[0], postCount: 7 }, ...goodReport().painPoints.slice(1)] })).toThrow('the pre-analyzed signals count 6');
    expect(() => validReport({ painPoints: [{ ...goodReport().painPoints[0], label: 'Reporting drag', postCount: 9 }, ...goodReport().painPoints.slice(1)] })).toThrow('from 0 to 8');
  });
  it('treats missing or empty quotes and links as soft shortfalls', () => {
    const output = validReport({ quotes: [], evidenceLinks: undefined, caveats: undefined });
    expect(output.quotes).toEqual([]);
    expect(output.evidenceLinks).toEqual([]);
    expect(output.warnings).toEqual(expect.arrayContaining(['Only 0 verified direct quotes (target 6–9).', 'Only 0 Twitter quotes (target at least 2).', 'Only 0 LinkedIn quotes (target at least 2).', 'Only 0 evidence links (target 8–10).']));
    expect(renderTrendReport(output)).toContain('No verified Twitter or LinkedIn quotes were available.');
  });
  it('enforces banned phrases for every edition and the Semrush editorial words for Semrush', () => {
    expect(() => validReport({ trendSummary: 'Teams have a blind spot in AI answers.' })).toThrow('banned phrase "blind spot"');
    expect(() => validReport({ keyTakeaways: ['Marketers are flying blind.', 'Two.', 'Three.'] }, { editionId: 'general' })).toThrow('flying blind');
    expect(() => validReport({ executiveSummary: 'A game-changer for search.' })).toThrow('banned word "game-changer"');
    expect(() => validReport({ caveats: ['Semrush One data was not supplied.'] })).toThrow('mentions "Semrush One"');
    expect(validReport({ executiveSummary: 'A game-changer for search.' }, { editionId: 'general' }).executiveSummary).toBe('A game-changer for search.');
  });
  it('renders the exact n8n report layout with code-rendered metrics and attributions', () => {
    const output = validReport();
    const markdown = renderTrendReport(output);
    const headings = ['# AI Answer Click Erosion — Comprehensive Trends Report', '## Executive Summary', '## Method Note', '## TREND: AI Answer Click Erosion', '### Trend Summary', '## Evidence & Validation', '### Aggregate Engagement Summary', '### Direct Quotes (Twitter & LinkedIn only)', '### Evidence Links', '## Top 3 Pain Points', '## Opportunities & Requests', '## Technical Details', '## Top Performing Content', '## Key Takeaways', '## Limitations'];
    const positions = headings.map(heading => markdown.indexOf(`${heading}\n`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown).toContain(`## Method Note\n\n${N8N_METHOD_NOTE}\n`);
    expect(markdown).toContain('- Twitter/X (3 posts): 44 Likes, 4 RTs, 11 Replies, 2,500 Views, 1 Quotes, 3 Bookmarks\n- LinkedIn (3 posts): 174 Reactions, 47 Comments, 3 Shares, 0 Views\n- Reddit (2 posts): 28 Upvotes, 58 Comments, Avg Score 14, Avg Ratio 0.90\n- Total: 8 posts');
    expect(markdown).toContain('"AI answers now resolve the question first. Organic click-through on those pages is down 41% this quarter." — @search_pat, Twitter, 2026-09-22 — https://example.com/x/x1 — 22 likes, 7 replies');
    expect(markdown).toContain('— pat-rivera-seo, LinkedIn, 2026-09-22 — https://example.com/linkedin/li1 — 77 reactions, 12 comments');
    expect(markdown).toContain('- **Reddit:** Explainer CTR fell to about 1% after AI answers rolled out — https://example.com/reddit/rd1 — 12 upvotes, 27 comments');
    expect(markdown).toContain('- **Twitter:** First organic slot still lost half its sessions — https://example.com/x/x2 — 9 likes, 1 RT');
    expect(markdown).toContain('**Loss of Traffic/Visibility** (6 posts — 75% of all posts): Click-through rates');
    expect(markdown).toContain('**Proving ROI/Attribution** (1 post — 13% of all posts)');
    expect(markdown).toContain('**Intent-tiered content:** Shift effort');
    expect(markdown).toContain('- **Most mentioned tools:** AI Overviews (6), Search Console (1)');
    expect(markdown).toContain('- **Highest engagement post:** "Personalized AI answers make today');
    expect(markdown).toContain('— LinkedIn (jordan-lee-test) — 89 reactions, 30 comments, prevalence 72. It drew the most comments in the set');
    expect(markdown).toContain('- **Most discussed topic:** Informational click loss — 6 mentions');
    expect(markdown).toContain('## Limitations\n\n- Only 4 verified direct quotes (target 6–9).');
    const gap = renderTrendReport({ ...output, coverage: { ...output.coverage, missingPlatforms: ['Reddit'] } });
    expect(gap).toContain('- Total: 8 posts\n- No data from: Reddit');
    expect(studio.renderContentExport(output)).toBe(markdown);
  });
  it('exports a static, escaped HTML report that Google delivery accepts', () => {
    const output = validReport({ trendSummary: '<script>alert(1)</script> & more' });
    const html = studio.renderContentExport(output, { format: 'html' });
    expect(html).toBe(renderTrendReport(output, { format: 'html' }));
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    expect(html).not.toMatch(/<script|<img|<iframe|<form/i);
    expect(html).toContain('<a href="https://example.com/x/x1" target="_blank" rel="noopener noreferrer">https://example.com/x/x1</a>');
    expect(html).toContain('<h3>Direct Quotes (Twitter &amp; LinkedIn only)</h3>');
    expect(html).toContain('#C190FF');
    expect(safeGoogleDocHtml(html)).toContain('Comprehensive Trends Report');
    expect(() => renderTrendReport(output, { format: 'pdf' })).toThrow('Markdown or HTML');
  });
});

describe('editorial toolkit', () => {
  it('builds the v6.1 prompt with segment rules, product IDs, context documents and metrics', () => {
    const { prompt, schema, context } = toolkitRequest();
    expect(prompt.startsWith('SYSTEM INSTRUCTIONS\nYou are a Semrush strategic marketing analyst.')).toBe(true);
    for (const text of ['- **ENTERPRISE segment** — exactly these registry entries: Enterprise AIO. These products may ONLY appear in the ENTERPRISE ANGLE section.', 'If you are unsure which segment a registry entry belongs to, treat it as Enterprise and keep it OUT of the SELF-SERVE ANGLE', '- enterprise-aio: Enterprise AIO — https://www.example.com/enterprise-aio/', '- ai-visibility-toolkit: AI Visibility Toolkit — https://www.example.com/ai/ — tools: Visibility, Citations, Prompt Research, Prompt Tracking, Brand Performance', '### Semrush One Rule\n- NEVER mention "Semrush One" anywhere in the output', 'Topic Research (SEO Toolkit) and Topic Finder (Content Toolkit) are the same tool', '- Combined limit: 8 named tools/capabilities across both angles', '- BANNED PHRASES: Never use "flying blind", "blind spot", or "blind spots"', '- ENTERPRISE ANGLE product must be one of: Enterprise AIO', `The SELF-SERVE ANGLE always opens with the literal line: ${AFFILIATE_SAFE_LINE}`]) expect(prompt).toContain(text);
    expect(prompt).toContain('## ⚠️ PRE-CALCULATED AGGREGATE METRICS — USE THESE NUMBERS VERBATIM\n\nThese numbers were computed before this prompt was assembled.');
    expect(prompt).toContain('- **On X (Twitter)** — 3 posts: 4 Retweets, 11 Replies, 44 Likes, 1 Quotes, 2,500 Views, 3 Bookmarks\n- **On LinkedIn** — 3 posts: 174 reactions, 47 comments\n- **On Reddit** — 2 posts: 28 upvotes, 58 comments\n\nTotal posts: 8');
    expect(prompt).toContain('### ICP (Ideal Customer Profile)\nFixture ICP: in-house search leads');
    expect(prompt).toContain('### Positioning\nBackground on personas and goals. Its toolkit names are informal (e.g. "AI Toolkit", "Local Marketing")');
    expect(prompt).toContain('### Semrush Product & Solution Registry (CANONICAL SOURCE — use EXACT names only)\nFixture Toolkit Registry');
    expect(prompt).toContain("### AI Search Positioning & Glossary (background for framing and vocabulary only)\nThis is Semrush's AI-search positioning guide, not a product list.");
    expect(prompt).toContain('### Reference: Launch calendar (background only)\nFixture launch calendar');
    expect(prompt).toContain('### Trends Brief (SOURCE DATA — transform this into the editorial toolkit format)\n# AI Answer Click Erosion — Comprehensive Trends Report');
    expect(prompt).toContain('### Trends Document URL (use this as the "Full evidence" link in EVIDENCE & VALIDATION)\nhttps://docs.example.com/trends/1');
    expect(prompt).toContain('□ ZERO mentions of "Semrush One" anywhere');
    expect(prompt).not.toContain('# TREND BRIEF TEMPLATE');
    schemaIsStrict(schema);
    expect(schema.properties.enterpriseAngle.properties.productId.enum).toEqual(['enterprise-aio']);
    expect(schema.properties.selfServeAngle.properties.productId.enum).toEqual(['seo-toolkit', 'ai-visibility-toolkit']);
    expect(schema.properties.selfServeAngle.properties.alsoFits.properties.productId.enum).toEqual(['', 'seo-toolkit', 'ai-visibility-toolkit']);
    expect(schema.properties.selfServeAngle.properties.keyTools).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(schema.properties.ctas.properties.plg).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(context).toMatchObject({ editionId: 'semrush', enterpriseProducts: ENTERPRISE, trendsDocUrl: 'https://docs.example.com/trends/1', metrics: { twitter: { totalLikes: 44 } } });
    const general = buildToolkitRequest({ trendReport: validReport(), products: products(), brandName: 'Fixture Co' });
    expect(general.prompt).toContain('Tool Name | Core Function | Key Tags\nKeyword Magic Tool | Builds keyword lists from a seed term | —');
    expect(general.prompt).not.toMatch(/Semrush/);
    expect(() => buildToolkitRequest({ products: products() })).toThrow('Generate the trends report');
  });
  it('still generates without a registry: each empty segment states the gap and the check is skipped', () => {
    const { prompt, schema, context } = buildToolkitRequest({ trendReport: validReport(), brandName: 'Fixture Co' });
    expect(schema.properties.enterpriseAngle.properties.productId.enum).toEqual(['']);
    expect(schema.properties.selfServeAngle.properties.productId.enum).toEqual(['']);
    expect(schema.properties.selfServeAngle.properties.alsoFits.properties.productId.enum).toEqual(['']);
    expect(schema.properties.enterpriseAngle.properties.capabilities.maxItems).toBe(0);
    expect(schema.properties.selfServeAngle.properties.keyTools.maxItems).toBe(0);
    schemaIsStrict(schema);
    expect(prompt).toContain('### PRODUCT REGISTRY GAP\n- No approved Enterprise product is registered for this workspace. Set enterpriseAngle.productId to ""');
    expect(prompt).toContain('begins "No approved self-serve toolkit is registered for this workspace"');
    expect(prompt).toContain('exactly these registry entries: none registered for this workspace (use productId "")');
    expect(prompt).toContain('(No product registry is loaded for this workspace. Do not name products or tools.)');
    expect(prompt).not.toContain('Look up each SELF-SERVE Key Tool');
    const gap = goodToolkit({ enterpriseAngle: { productId: '', paragraph: 'No approved Enterprise product is registered for this workspace. Large brands face the same click loss across markets.', capabilities: [] }, selfServeAngle: { productId: '', paragraph: 'No approved self-serve toolkit is registered for this workspace. Small teams need a way to see AI answer presence.', keyTools: [], alsoFits: { productId: '', toolNames: [], text: '' } } });
    const { output, flags } = validateToolkit(gap, context);
    expect(flags).toEqual([]);
    expect(output.toolkitCheck).toEqual({ status: 'skipped', reason: 'No product registry loaded.' });
    expect(output.caveats).toEqual(['No product registry loaded: the Enterprise and Self-serve angles describe the gap instead of naming products.']);
    expect(output.approvedProducts).toEqual([]);
    expect(output.enterpriseAngle).toMatchObject({ productId: '', productName: '', capabilities: [] });
    const markdown = renderToolkit(output);
    expect(markdown).toContain('## ENTERPRISE ANGLE\n\nNo approved Enterprise product is registered for this workspace.');
    expect(markdown).toContain(`## SELF-SERVE ANGLE (PLG)\n\n${AFFILIATE_SAFE_LINE}\n\nNo approved self-serve toolkit is registered`);
    expect(markdown).not.toMatch(/Key Capabilities|Key Tools|Also fits|TOOLKIT CHECK/);
    expect(safeGoogleDocHtml(renderToolkit(output, { format: 'html' }))).toContain('ENTERPRISE ANGLE');
    expect(() => validateToolkit({ ...gap, enterpriseAngle: { ...gap.enterpriseAngle, productId: 'enterprise-aio' } }, context)).toThrow('No Enterprise product is registered for this workspace, so enterpriseAngle.productId must be ""');
    // Items in a gap angle could only be invented: they are dropped and flagged, never rendered.
    const invented = validateToolkit({ ...gap, selfServeAngle: { ...gap.selfServeAngle, keyTools: [{ toolName: 'Site Audit', text: 'Invented.' }] }, enterpriseAngle: { ...gap.enterpriseAngle, capabilities: [1, 2, 3].map(n => ({ name: `Capability ${n}`, text: 'Invented.' })) } }, context);
    expect(invented.output.selfServeAngle.keyTools).toEqual([]);
    expect(invented.output.enterpriseAngle.capabilities).toEqual([]);
    expect(invented.flags.map(flag => flag.code)).toEqual(['gap-angle-items-dropped', 'gap-angle-items-dropped']);
    expect(renderToolkit(invented.output)).not.toMatch(/Site Audit|Capability 1/);
    expect(() => validateToolkit({ ...gap, hooks: ['Semrush One is the answer', 'b', 'c', 'd', 'e'] }, context)).toThrow('Semrush One');
  });
  it('keeps every hard rule for the registered segment when only one segment exists', () => {
    const { schema, context } = buildToolkitRequest({ trendReport: validReport(), products: products().filter(p => p.segment !== 'enterprise'), editionId: 'semrush' });
    expect(schema.properties.enterpriseAngle.properties.productId.enum).toEqual(['']);
    expect(schema.properties.selfServeAngle.properties.productId.enum).toEqual(['seo-toolkit', 'ai-visibility-toolkit']);
    const partial = goodToolkit({ enterpriseAngle: { productId: '', paragraph: 'No approved Enterprise product is registered for this workspace.', capabilities: [] } });
    const { output } = validateToolkit(partial, context);
    expect(output.toolkitCheck.status).toBe('pass');
    expect(output.caveats).toEqual(['No Enterprise product is registered: the Enterprise angle describes the gap instead of naming a product.']);
    expect(validateToolkit({ ...partial, enterpriseAngle: { ...partial.enterpriseAngle, capabilities: [{ name: 'Governance', text: 'Invented.' }] } }, context).output.enterpriseAngle.capabilities).toEqual([]);
    expect(() => validateToolkit({ ...partial, headlines: ['Site Audit finds it', 'b', 'c', 'd', 'e'] }, context)).toThrow('names "Site Audit"');
    expect(() => validateToolkit({ ...partial, selfServeAngle: { ...partial.selfServeAngle, productId: '' } }, context)).toThrow('is not an affiliate-eligible self-serve toolkit');
  });
  it('accepts an aligned toolkit, resolves products and passes Prompt Research tool and Topic Finder aliases', () => {
    const request = toolkitRequest();
    const { output, flags } = validateToolkit(goodToolkit(), request.context);
    expect(flags).toEqual([]);
    expect(output.toolkitCheck).toEqual({ status: 'pass', reason: '', headline: 'AI Visibility Toolkit', misaligned: [], tools: ['Visibility', 'Citations report', 'Prompt Research tool'] });
    expect(output).toMatchObject({ deliverableId: 'editorial-toolkit', layout: TOOLKIT_LAYOUT, title: 'TREND: AI Answer Click Erosion', enterpriseAngle: { productName: 'Enterprise AIO', productUrl: 'https://www.example.com/enterprise-aio/' }, selfServeAngle: { productName: 'AI Visibility Toolkit', alsoFits: { productId: 'seo-toolkit', productName: 'SEO Toolkit', toolNames: ['Topic Finder'] } } });
    expect(output.selfServeAngle.keyTools[2]).toMatchObject({ toolName: 'Prompt Research tool', url: 'https://www.example.com/ai/prompts/' });
    expect(output.ctas.enterprise[1]).toBe('Give leadership a governed view of AI shopping shelves.');
    expect(output.approvedProducts.map(p => p.id)).toEqual(['enterprise-aio', 'ai-visibility-toolkit', 'seo-toolkit']);
    const seo = validateToolkit(withSelfServe({ productId: 'seo-toolkit', keyTools: [{ toolName: 'Topic Finder', text: 'a' }, { toolName: 'Site Audit', text: 'b' }, { toolName: 'Keyword Magic Tool', text: 'c' }], alsoFits: { productId: '', toolNames: [], text: '' } }), request.context);
    expect(seo.output.toolkitCheck.status).toBe('pass');
    expect(seo.output.selfServeAngle.alsoFits).toBeNull();
  });
  it('flags borrowed Key Tools and Also fits tools like the n8n guard, without blocking', () => {
    const request = toolkitRequest();
    const aiMode = validateToolkit(withSelfServe({ keyTools: [{ toolName: 'Visibility', text: 'a' }, { toolName: 'Topic Finder', text: 'b' }, { toolName: 'Traffic Analytics (Traffic & Market Toolkit)', text: 'c' }] }), request.context);
    expect(aiMode.output.toolkitCheck).toEqual({ status: 'flag', reason: 'Not listed under AI Visibility Toolkit in the Registry.', headline: 'AI Visibility Toolkit', misaligned: ['Topic Finder', 'Traffic Analytics'] });
    expect(aiMode.flags.map(flag => flag.code)).toEqual(['key-tools-outside-toolkit']);
    const also = validateToolkit(withSelfServe({ alsoFits: { productId: 'seo-toolkit', toolNames: ['Citations'], text: 'Citations pairs with keyword research.' } }), request.context);
    expect(also.output.toolkitCheck).toMatchObject({ status: 'flag', reason: 'Also fits tools not listed under SEO Toolkit in the Registry.', misaligned: ['Citations'] });
    const markdown = renderToolkit(aiMode.output);
    expect(markdown.startsWith('⚠️ TOOLKIT CHECK — review before publishing: Not listed under AI Visibility Toolkit in the Registry. Tools: Topic Finder, Traffic Analytics.\n\n# TREND: AI Answer Click Erosion')).toBe(true);
  });
  it('rejects Semrush One, crossed segments, product names in agnostic copy and too many tools', () => {
    const { context } = toolkitRequest();
    const check = (output, message) => expect(() => validateToolkit(output, context)).toThrow(message);
    check(goodToolkit({ ctas: { ...goodToolkit().ctas, plg: ['Start with Semrush One today.', 'b', 'c'] } }), 'mentions "Semrush One"');
    check(goodToolkit({ enterpriseAngle: { ...goodToolkit().enterpriseAngle, productId: 'seo-toolkit' } }), 'is not an Enterprise product. Use one of: enterprise-aio');
    check(withSelfServe({ productId: 'enterprise-aio' }), 'is not an affiliate-eligible self-serve toolkit');
    check(withSelfServe({ alsoFits: { productId: 'ai-visibility-toolkit', toolNames: [], text: 'Same toolkit.' } }), 'different toolkit');
    check(withSelfServe({ alsoFits: { productId: 'enterprise-aio', toolNames: [], text: 'Enterprise fit.' } }), 'Enterprise products never appear here');
    const stray = validateToolkit(withSelfServe({ alsoFits: { productId: '', toolNames: ['Site Audit'], text: 'No strong second fit.' } }), context);
    expect(stray.output.selfServeAngle.alsoFits).toBeNull();
    expect(stray.flags.map(flag => flag.code)).toEqual(['also-fits-without-toolkit']);
    expect(renderToolkit(stray.output)).not.toContain('Also fits');
    check(goodToolkit({ headlines: ['Site Audit finds what AI crawlers miss', 'b', 'c', 'd', 'e'] }), 'headlines[0] names "Site Audit"');
    check(goodToolkit({ hooks: ['Why the AI SEO Toolkit matters', 'b', 'c', 'd', 'e'] }), 'names "AI SEO Toolkit"');
    check(goodToolkit({ howToTalk: { ...goodToolkit().howToTalk, intro: 'Lead with the seo toolkit story.' } }), 'howToTalk.intro names "SEO Toolkit"');
    check(goodToolkit({ whyMatters: { ...goodToolkit().whyMatters, painPoints: [{ label: 'Brand performance', text: 'x' }, ...goodToolkit().whyMatters.painPoints.slice(1)] } }), 'names "Brand Performance"');
    check(withSelfServe({ paragraph: 'Teams that outgrow it can move to Enterprise AIO.' }), 'names the Enterprise product "Enterprise AIO"');
    check(goodToolkit({ whatHappened: 'Marketers have a blind spot.' }), 'banned phrase "blind spot"');
    check(goodToolkit({ subheads: ['A revolutionary shift', 'b', 'c', 'd', 'e'] }), 'banned word "revolutionary"');
    check(goodToolkit({ enterpriseAngle: { ...goodToolkit().enterpriseAngle, capabilities: [...goodToolkit().enterpriseAngle.capabilities, { name: 'Multi-market rollups', text: 'x' }] }, selfServeAngle: { ...goodToolkit().selfServeAngle, keyTools: [...goodToolkit().selfServeAngle.keyTools, { toolName: 'Prompt Tracking', text: 'x' }, { toolName: 'Brand Performance', text: 'y' }] } }), 'combined limit is 8');
    check(goodToolkit({ ctas: { enterprise: ['Only one'], plg: ['a', 'b', 'c'] } }), 'ctas.enterprise needs exactly 2 items (got 1)');
    // Single generic tool words stay usable in product-agnostic copy.
    expect(validateToolkit(goodToolkit({ headlines: ['Visibility and citations moved into AI answers', 'b', 'c', 'd', 'e'] }), context).output.headlines[0]).toBe('Visibility and citations moved into AI answers');
  });
  it('renders the v6.1 template with code-rendered evidence and the trends doc link', () => {
    const { context } = toolkitRequest();
    const { output } = validateToolkit(goodToolkit(), context);
    const markdown = renderToolkit(output);
    const order = ['# TREND: AI Answer Click Erosion', '## WHAT HAPPENED', '## WHY THIS MATTERS TO MARKETERS', '## HOW TO TALK ABOUT IT', '## ENTERPRISE ANGLE', '**Enterprise AIO — https://www.example.com/enterprise-aio/**', '**Key Capabilities:**', '## SELF-SERVE ANGLE (PLG)', AFFILIATE_SAFE_LINE, '**AI Visibility Toolkit — https://www.example.com/ai/**', '**Key Tools:**', '**Also fits:** SEO Toolkit — https://www.example.com/seo/ — Topic Finder surfaces', '## POTENTIAL HEADLINES & HOOKS', '### Headlines', '### Subheads', '### Hooks', '### CTAs', '## EVIDENCE & VALIDATION', 'Across our influencer database:'];
    const positions = order.map(text => markdown.indexOf(text));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown.startsWith('# TREND: AI Answer Click Erosion\n\n## WHAT HAPPENED\n\n')).toBe(true);
    expect(markdown).toContain('- **Click loss:** Informational pages lose clicks even at position one.');
    expect(markdown).toContain('- **Citation Economics:** Being cited is the new click.');
    expect(markdown).toContain('- **Shopping Shelf Tracking:** Shows where products appear in AI shopping answers.');
    expect(markdown).toContain('- **Citations report:** Shows which pages AI answers cite.');
    expect(markdown).toContain('- [ENT] Report AI answer presence across every brand and market.\n- [ENT] Give leadership a governed view of AI shopping shelves.\n- [PLG] Track the prompts that matter to your category daily.\n- [PLG] See which of your pages AI answers cite.\n- [PLG] Find the questions buyers ask AI tools.');
    expect(markdown).toContain('Across our influencer database:\n\n- **On X (Twitter)** — 3 posts: 4 Retweets, 11 Replies, 44 Likes, 1 Quotes, 2,500 Views, 3 Bookmarks\n- **On LinkedIn** — 3 posts: 174 reactions, 47 comments\n- **On Reddit** — 2 posts: 28 upvotes, 58 comments\n\n[Full evidence, quotes, and source links.](https://docs.example.com/trends/1)\n');
    expect(markdown).not.toContain('TOOLKIT CHECK');
    const unlinked = renderToolkit({ ...output, trendsDocUrl: '' });
    expect(unlinked).toContain('Full evidence, quotes, and source links are in the paired trends report.');
    expect(renderToolkit({ ...output, trendsDocUrl: '' }, { trendsDocUrl: 'https://docs.example.com/trends/2' })).toContain('[Full evidence, quotes, and source links.](https://docs.example.com/trends/2)');
    expect(studio.renderContentExport(output)).toBe(markdown);
    const html = studio.renderContentExport({ ...output, toolkitCheck: { status: 'flag', reason: 'Not listed under AI Visibility Toolkit in the Registry.', misaligned: ['Topic Finder'] } }, { format: 'html' });
    expect(html).toContain('<p class="flag">⚠️ TOOLKIT CHECK — review before publishing: Not listed under AI Visibility Toolkit in the Registry. Tools: Topic Finder.</p>');
    expect(html).toContain('<em>Affiliate-safe: this section references self-serve toolkits and tools only.</em>');
    expect(html).toContain('<a href="https://docs.example.com/trends/1" target="_blank" rel="noopener noreferrer">Full evidence, quotes, and source links.</a>');
    expect(html).toContain('<li><strong>On X (Twitter)</strong> — 3 posts: 4 Retweets');
    expect(safeGoogleDocHtml(html)).toContain('SELF-SERVE ANGLE (PLG)');
  });
});

describe('content studio integration', () => {
  const evidence = Array.from({ length: 500 }, (_, i) => ({ id: `evidence-${i}`, text: `Post ${i} ${'x'.repeat(1500)}`, url: `https://example.com/post/${i}`, platform: 'linkedin', author: `author-${i}`, publishedAt: '2026-09-22T12:00:00.000Z' }));
  const researchSource = (extra = {}) => ({ kind: 'research-theme', id: 'run-a-theme-ai', title: theme.name, text: 'Paired reports for the AI Answer Click Erosion theme.', evidence, research: { theme, selection: selection(), brandName: 'Semrush', analysisFocus: 'SEO Trends', targetAudience: 'SEO Professionals' }, ...extra });
  it('accepts research-theme sources, carries research through and allows the larger context budget', () => {
    const source = researchSource();
    const normalized = studio.normalizeSource(source);
    expect(normalized.kind).toBe('research-theme');
    expect(normalized.research).toEqual(source.research);
    expect(normalized.evidence).toHaveLength(501);
    expect(JSON.stringify(normalized).length).toBeGreaterThan(studio.MAX_CONTEXT_CHARS);
    expect(studio.normalizeSource(normalized)).toEqual(normalized);
    const plan = studio.buildContentPlan({ editionId: 'semrush', source, deliverableIds: ['evidence-report', 'editorial-toolkit'] });
    expect(plan.deliverables.map(d => d.id)).toEqual(['evidence-report', 'editorial-toolkit']);
    expect(() => studio.normalizeSource({ ...source, kind: 'text', research: undefined })).toThrow('400,000-character');
    expect(() => studio.normalizeSource(researchSource({ research: undefined }))).toThrow('source.research must be an object');
    expect(() => studio.normalizeSource(researchSource({ research: { padding: 'y'.repeat(1000001) } }))).toThrow('1,000,000-character');
    expect(() => studio.normalizeSource({ ...source, kind: 'other' })).toThrow('saved report');
  });
});
