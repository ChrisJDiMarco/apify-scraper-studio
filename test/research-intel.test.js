import { describe, expect, it } from 'vitest';
import intel from '../src/shared/research-intel.js';
import engine from '../src/shared/research-program.js';
import prompts from '../src/shared/research-prompts.js';
const { parseTaxonomyRows, validateTaxonomy, taxonomySummary, matchToTaxonomy, deriveRecentTrend, deriveGapSignal, scoreTheme, themeNameIssues, rankThemes, preferredThemeName } = intel;
const { mergeCandidates, validateThemeMatches, prepareResearchEvidence, buildDiscoveryBatches, buildAssignmentBatches } = engine;

// A synthetic Taxonomy Lookup tab in the n8n sheet layout (trailing unnamed monthly columns).
const header = ['Category', 'Article Count', '% Share', 'Velocity', 'Last 6Mo', '6Mo Rate', 'Saturation', 'Zone', 'Top Keywords', 'Top Phrases', 'Timeline', 'Gap Analysis Notes', 'Editorial Action', '', '', '', '', '', ''];
const rows = [header,
  ['AI Search / GEO', '151', '11.30%', 'ACCELERATING', '126', 'HIGH', 'HIGH', 'SATURATED', 'search, chatgpt, llm, overviews', 'llm optimization, generative engine', '2025:113', 'Refresh angles.', 'Cross-check titles.', '42', '14', '10', '22', '21', '6'],
  ['Analytics & Measurement', '69', '5.10%', 'DORMANT', '8', 'LOW', 'MEDIUM', 'OPEN', 'analytics, attribution, ga4', 'google analytics, share voice', '2025:27', 'Open territory.', 'Fast-track.', '2', '2', '0', '1', '1', '0'],
  ['Local SEO', '56', '4.20%', 'SLOWING', '16', 'MED', 'MEDIUM', 'MODERATE', 'local, reviews, maps', 'local seo, business profile', '2025:39', '', 'Title-level check.', '4', '0', '4', '0', '1', '1'],
];

describe('taxonomy lookup (n8n Store Taxonomy in Static Data)', () => {
  it('parses the tab, lower-cases keyword lists and reads trailing unnamed monthly columns oldest → newest', () => {
    const categories = parseTaxonomyRows(rows);
    expect(categories).toHaveLength(3);
    expect(categories[0]).toMatchObject({ category: 'AI Search / GEO', articleCount: 151, velocity: 'ACCELERATING', last6Mo: 126, zone: 'SATURATED', topKeywords: ['search', 'chatgpt', 'llm', 'overviews'], topPhrases: ['llm optimization', 'generative engine'] });
    expect(categories[0].monthly.map((m) => m.count)).toEqual([42, 14, 10, 22, 21, 6]);
    const named = parseTaxonomyRows([[...header.slice(0, 13), 'SEP 25', 'OCT 25', 'NOV 25', 'DEC 25', 'JAN 26', 'FEB 26'], ...rows.slice(1)]);
    expect(named[1].monthly).toEqual([{ label: 'SEP 25', count: 2 }, { label: 'OCT 25', count: 2 }, { label: 'NOV 25', count: 0 }, { label: 'DEC 25', count: 1 }, { label: 'JAN 26', count: 1 }, { label: 'FEB 26', count: 0 }]);
    expect(() => parseTaxonomyRows([['Name', 'Value'], ['a', 'b']])).toThrow(/Category and Zone/);
    expect(validateTaxonomy({ categories })).toMatchObject({ categories: expect.any(Array) });
    expect(taxonomySummary({ categories })).toContain('- Analytics & Measurement | Zone: OPEN | Keywords: analytics, attribution, ga4 | Editorial: Fast-track.');
  });
  it('matches themes like n8n: Claude category, then partial, then keyword (×1) and phrase (×3) overlap', () => {
    const taxonomy = { categories: parseTaxonomyRows(rows) };
    expect(matchToTaxonomy(taxonomy, { name: 'x', category: 'analytics & measurement' })).toMatchObject({ category: 'Analytics & Measurement', matchMethod: 'claude_assigned' });
    expect(matchToTaxonomy(taxonomy, { name: 'x', category: 'Local' })).toMatchObject({ category: 'Local SEO', matchMethod: 'claude_partial' });
    expect(matchToTaxonomy(taxonomy, { name: 'Local SEO Review Squeeze', description: 'reviews on the business profile', category: 'NONE' })).toMatchObject({ category: 'Local SEO', matchMethod: 'keyword_phrase_match', phraseMatches: 2 });
    expect(matchToTaxonomy(taxonomy, { name: 'Satellite Apps', description: 'micro products', category: 'NONE' })).toBeNull();
  });
  it('derives recent editorial trend and gap signal exactly like Calculate Trend Velocity', () => {
    const [ai, analytics, local] = parseTaxonomyRows(rows);
    expect(deriveRecentTrend(ai)).toBe('ACTIVE'); // last three months 22 + 21 + 6
    expect(deriveRecentTrend(analytics)).toBe('DORMANT'); // 1 + 1 + 0 = 2
    expect(deriveRecentTrend(local)).toBe('DORMANT'); // 0 + 1 + 1 = 2
    expect(deriveRecentTrend({ velocity: 'ACCELERATING', monthly: [] })).toBe('ACTIVE');
    expect(deriveGapSignal(ai)).toBe('LOW_OPPORTUNITY');
    expect(deriveGapSignal(analytics)).toBe('HIGH_OPPORTUNITY');
    expect(deriveGapSignal(local)).toBe('HIGH_OPPORTUNITY'); // MODERATE + DORMANT
    expect(deriveGapSignal(null)).toBe('NEW_TERRITORY');
  });
  it('scores and tiers a theme with the n8n weights, including the phrase-overlap penalty', () => {
    const taxonomy = { categories: parseTaxonomyRows(rows) };
    const saturated = scoreTheme({ theme: { name: 'LLM Optimization Tool Surge', description: 'generative engine tools', novelty: 'EVERGREEN', taxonomyCategory: 'AI Search / GEO' }, detectionCount: 3, taxonomy });
    // LOW_OPPORTUNITY 1×2 + ACCELERATING 3×1.5 + EVERGREEN 1 + ACTIVE 0 − 2 overlap = 5.5
    expect(saturated).toMatchObject({ priorityScore: 5.5, priorityTier: 'LOW', velocity: 'ACCELERATING', count: 3, gapSignal: 'LOW_OPPORTUNITY', phraseOverlap: ['llm optimization', 'generative engine'] });
    const open = scoreTheme({ theme: { name: 'GA4 Attribution Breakdown', novelty: 'NEW TOPIC', taxonomyCategory: 'Analytics & Measurement', gapRationale: 'Few recent articles.' }, detectionCount: 1, taxonomy });
    expect(open).toMatchObject({ priorityScore: 13.5, priorityTier: 'STRONG', gapRationale: 'Few recent articles.', taxonomy: { category: 'Analytics & Measurement', zone: 'OPEN', articleCount: 69 } });
  });
});

describe('theme names (n8n To Rows (6) and NAME QUALITY OVERRIDE)', () => {
  it('flags bloated names and ranks clean, cross-platform, well-evidenced themes first', () => {
    expect(themeNameIssues('AI Overviews Traffic Collapse')).toEqual([]);
    expect(themeNameIssues('The Evolution of the Search Landscape Today')).toEqual(['too_long_7w', 'generic_ai_speak', 'filler_start']);
    expect(themeNameIssues('Panic')).toEqual(['too_short_1w']);
    const ranked = rankThemes([{ name: 'The Rise of Something Big Happening Now Here', crossPlatform: true, totalEvidence: 90 }, { name: 'INP Diagnosis Confusion', crossPlatform: false, totalEvidence: 5 }, { name: 'AI Overviews Traffic Collapse', crossPlatform: true, totalEvidence: 20 }]);
    expect(ranked.map((t) => t.name)).toEqual(['AI Overviews Traffic Collapse', 'INP Diagnosis Confusion', 'The Rise of Something Big Happening Now Here']);
    expect(preferredThemeName({ proposed: 'Google SGE Zero-Click Impact on Informational Queries', existing: 'AI Overviews Traffic Collapse' })).toBe('AI Overviews Traffic Collapse');
    expect(preferredThemeName({ proposed: 'INP Diagnosis Confusion', existing: 'Core Web Vitals INP Score Diagnosis Issues' })).toBe('INP Diagnosis Confusion');
  });
  it('validates the matching agent: known IDs only, one new theme per tracked theme, clean names win', () => {
    const themes = [{ id: 't1', name: 'AI Overviews Traffic Collapse' }, { id: 't2', name: 'Core Web Vitals INP Score Diagnosis Issues' }, { id: 't3', name: 'Reddit Answer Box Surge' }];
    const existing = [{ id: 'old-1', name: 'Google SGE Zero-Click Impact on Informational Queries' }, { id: 'old-2', name: 'INP Diagnosis Confusion' }];
    const result = validateThemeMatches({ matches: [
      { themeId: 't1', matchedExistingId: 'old-1', finalName: 'Google SGE Zero-Click Impact on Informational Queries', nameSource: 'existing', reason: 'Same topic.' },
      { themeId: 't2', matchedExistingId: 'old-2', finalName: 'INP Diagnosis Confusion', nameSource: 'existing', reason: 'Same topic.' },
      { themeId: 't3', matchedExistingId: 'old-2', finalName: 'Reddit Answer Box Surge', nameSource: 'new', reason: 'Duplicate claim.' },
    ] }, { themes, existing });
    expect(result.matches.map((m) => [m.themeId, m.matchedExistingId, m.finalName, m.nameSource])).toEqual([
      ['t1', 'old-1', 'AI Overviews Traffic Collapse', 'new'],
      ['t2', 'old-2', 'INP Diagnosis Confusion', 'existing'],
      ['t3', null, 'Reddit Answer Box Surge', 'new'],
    ]);
    expect(() => validateThemeMatches({ matches: [{ themeId: 't1', matchedExistingId: 'invented', finalName: 'x y z', nameSource: 'new', reason: '' }] }, { themes, existing })).toThrow(/existing theme ID/);
  });
});

describe('candidate merge and stage prompts', () => {
  const row = (id, platform, extra = {}) => ({ id: `raw-${id}`, externalId: String(id), platform, type: 'post', author: `author${id}`, text: `Post ${id}: AI Overviews erased our clicks again`, url: `https://example.com/${platform}/${id}`, publishedAt: '2026-10-01T12:00:00Z', raw: { likeCount: 300, replyCount: 40, retweetCount: 20, quoteCount: 5, bookmarkCount: 9, viewCount: 9000, upVotes: 90, numberOfComments: 30, upVoteRatio: 0.9 }, ...extra });
  const evidence = prepareResearchEvidence({ runId: 'run-a', program: { name: 'P', sourceGroups: [{ platform: 'x', targets: ['a'] }] }, items: [row(1, 'x'), row(2, 'x'), row(3, 'reddit', { raw: { title: 'Clicks gone', upVotes: 90, numberOfComments: 30, upVoteRatio: 0.9, username: 'redditor3' } }), row(4, 'linkedin', { raw: { author: { publicIdentifier: 'li-person', name: 'Li Person' }, likes: 80, comments: 20 } })] }).items;
  it('merges candidates by name like Aggregate Batch Candidates, keeping evidence and source IDs', () => {
    const base = { runId: 'run-a', summary: 's', painPoint: 'Loss of Traffic/Visibility', actionability: 'a' };
    const merged = mergeCandidates([{ ...base, id: 'c1', name: 'AI Overview Click Loss', semanticIntentSignals: ['clicks gone'], evidenceIds: ['e1', 'e2'], evidenceCount: 2, platforms: ['x'] }, { ...base, id: 'c2', name: 'ai overview click loss ', semanticIntentSignals: ['traffic fell off a cliff', 'clicks gone'], evidenceIds: ['e2', 'e3'], evidenceCount: 2, platforms: ['reddit'] }, { ...base, id: 'c3', name: 'Other', semanticIntentSignals: [], evidenceIds: ['e9'], evidenceCount: 1, platforms: ['x'] }]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ name: 'AI Overview Click Loss', evidenceIds: ['e1', 'e2', 'e3'], evidenceCount: 3, platforms: ['x', 'reddit'], semanticIntentSignals: ['clicks gone', 'traffic fell off a cliff'], sourceCandidateIds: ['c1', 'c2'] });
  });
  it('batches discovery per platform with the n8n engagement order and keeps author handles', () => {
    const { batches } = buildDiscoveryBatches({ runId: 'run-a', items: evidence });
    expect(batches.map((b) => b.platform)).toEqual(['x', 'linkedin', 'reddit']);
    expect(evidence.find((i) => i.platform === 'linkedin')).toMatchObject({ author: 'li-person', authorName: 'Li Person' });
    expect(evidence.find((i) => i.platform === 'reddit')).toMatchObject({ author: 'redditor3', title: 'Clicks gone' });
    const prompt = prompts.discoveryPrompt({ batch: batches[0], editionId: 'semrush' });
    expect(prompt).toContain("You are Semrush's elite SEO Data Miner");
    expect(prompt).toContain('ZERO TOLERANCE FOR NOISE');
    expect(prompt).toContain('Analyze 2 posts from Twitter. Identify up to 10 highly specific candidate trends.');
    expect(prompt).not.toContain('PROGRAM FOCUS');
    expect(prompts.discoveryPrompt({ batch: batches[0], editionId: 'general', brandName: 'Acme', query: 'pricing' })).toMatch(/You are Acme's elite market Data Miner[\s\S]*PROGRAM FOCUS[^\n]*pricing/);
  });
  it('builds the tagging prompt with theme blocks, IDs and only record IDs plus text', () => {
    const { batches } = buildAssignmentBatches({ runId: 'run-a', items: evidence });
    const themes = [{ id: 'theme-1', name: 'AI Overviews Traffic Collapse', description: 'Clicks vanish.', matchingKeywords: ['zero click', 'AIO'], matchingCriteria: 'Posts about lost clicks.', negativeCriteria: 'General AI hype.' }];
    const prompt = prompts.taggingPrompt({ batch: batches[0], themes, editionId: 'semrush' });
    // Short Theme IDs (T1…) and record_ids (p1…) keep the model from mis-copying long hex IDs.
    expect(prompt).toContain('THEME 1: AI Overviews Traffic Collapse\nTheme ID: T1\nDescription: Clicks vanish.\nAlternative phrases/keywords to look for: zero click, AIO\nMATCH IF: Posts about lost clicks.\nDO NOT MATCH IF: General AI hype.');
    expect(prompt).toContain('Match based on SEMANTIC INTENT, not just exact keywords.');
    expect(prompt).toContain('- 0.55-0.69: Tangentially related, but useful for a trend report.');
    expect(prompt).toMatch(/POSTS TO ANALYZE \(2\):\n\[\{"record_id":"p1","post_text":/); expect(prompt).not.toContain('evidence-');
    expect(prompt).not.toContain('likeCount');
  });
  it('builds synthesis with the taxonomy and naming rules, and matching with tracked IDs', () => {
    const taxonomy = { categories: parseTaxonomyRows(rows) };
    const candidates = [{ id: 'c1', runId: 'run-a', name: 'AI Overview Click Loss', summary: 's', painPoint: 'Loss of Traffic/Visibility', semanticIntentSignals: ['clicks gone'], actionability: 'a', evidenceIds: ['e1'], evidenceCount: 1, platforms: ['x'] }];
    const synthesis = prompts.synthesisPrompt({ candidates, totalPosts: 2, sources: { Twitter: 2 }, maxThemes: 6, taxonomy, editionId: 'semrush' });
    expect(synthesis).toContain('Synthesize raw social trend candidates into exactly 6 actionable SEO and search-marketing themes.');
    expect(synthesis).toContain('- Use 3-6 words per theme name.');
    expect(synthesis).toContain('- Analytics & Measurement | Zone: OPEN');
    const matching = prompts.matchingPrompt({ themes: [{ id: 't1', name: 'AI Overviews Traffic Collapse', description: 'd' }], existing: [{ id: 'old-1', name: 'INP Diagnosis Confusion', description: 'x' }], editionId: 'semrush' });
    expect(matching).toContain('NAME QUALITY OVERRIDE');
    expect(matching).toContain('"id": "old-1"');
    expect(prompts.repairInstruction(new Error('Quotes must be exact'), { a: 1 })).toContain('REJECTED BY VALIDATION: Quotes must be exact');
  });
});
