import { describe, expect, it } from 'vitest';
import lib from '../src/shared/research-scan-report.js';
import content from '../src/shared/content-studio.js';
import template from '../src/shared/prompt-template.js';
import samples from '../src/shared/prompt-samples.json';
const { selectScanEvidence, buildScanReportRequest, validateScanReport, scanReportEstimate, scanSummary, scanSource, windowLabel, samplePayload, SCAN_REPORT_SCHEMA } = lib;

// The quick scan's short trends report (SPEC-3): the posts it reads, the prompt it sends, and the checks its answer passes.
const post = (id, engagement, text = `Post ${id} says dashboards take too much manual work.`) => ({ id, platform: 'x', author: `person-${id}`, text, url: `https://x.com/p/${id}`, publishedAt: '2026-10-17T09:00:00Z', engagement: { value: engagement } });
const theme = (id, name, evidenceIds, extra = {}) => ({ id, name, description: `${name}, as the scan describes it.`, evidenceIds, evidenceCount: evidenceIds.length, platforms: ['x'], scoring: { priorityTier: 'STRONG' }, ...extra });

describe('selectScanEvidence', () => {
  it('fills round-robin so every trend gets at least two posts, most engaged first, without repeats, up to the cap', () => {
    const items = Array.from({ length: 60 }, (_, i) => post(`p${i}`, i));
    const themes = [theme('a', 'A', items.slice(0, 30).map((row) => row.id)), theme('b', 'B', items.slice(25, 60).map((row) => row.id)), theme('c', 'C', ['p1', 'p2'])];
    const { posts, byTheme } = selectScanEvidence({ themes, items, maxPosts: 12 });
    expect(posts).toHaveLength(12);
    expect(posts.map((row) => row.ref)).toEqual(posts.map((_, i) => `E${i + 1}`));
    expect(new Set(posts.map((row) => row.id)).size).toBe(12);
    for (const id of ['a', 'b', 'c']) expect(byTheme[id].length).toBeGreaterThanOrEqual(2);
    // The most engaged post of each trend comes first.
    expect(posts.find((row) => row.ref === byTheme.a[0]).id).toBe('p29');
    expect(posts.find((row) => row.ref === byTheme.b[0]).id).toBe('p59');
  });
  it('shares a post two trends cite, and keeps only https links', () => {
    const items = [post('x1', 5), { ...post('x2', 4), url: 'http://example.com/a' }];
    const { posts, byTheme } = selectScanEvidence({ themes: [theme('a', 'A', ['x1', 'x2']), theme('b', 'B', ['x1'])], items });
    expect(posts).toHaveLength(2);
    expect(byTheme.b).toEqual([byTheme.a[0]]);
    expect(posts[1].url).toBe('');
  });
});

describe('buildScanReportRequest', () => {
  const items = Array.from({ length: 6 }, (_, i) => post(`p${i}`, 10 - i));
  const themes = [theme('a', 'Manual reporting', ['p0', 'p1', 'p2']), theme('b', 'Client churn', ['p3', 'p4'])];
  const run = { id: 'research-scan', createdAt: '2026-10-17T10:00:00Z', quickScan: { topic: 'reporting', lookbackHours: 6, platforms: ['x'] } };
  const scan = scanSummary({ run, themes, postCount: items.length });
  const selection = selectScanEvidence({ themes, items });

  it('lays out the frame, the scan, the trends and the posts, with the workspace’s saved blocks', () => {
    const request = buildScanReportRequest({ scan, selection, editionId: 'semrush', brandName: 'Semrush' });
    expect(request.prompt.startsWith('SYSTEM INSTRUCTIONS\nYou are a social listening analyst for Semrush. A quick scan just read recent posts about “reporting” from the last 6 hours.')).toBe(true);
    for (const marker of ['## RULES', '\nTASK\n', 'QUICK SCAN:', 'TRENDS (in order;', 'POSTS:', '## STRUCTURED OUTPUT (required)', 'Return JSON only, matching the schema.']) expect(request.prompt).toContain(marker);
    expect(request.prompt).toContain(', written for SEO professionals');
    expect(request.schema).toBe(SCAN_REPORT_SCHEMA);
    const saved = buildScanReportRequest({ scan, selection, editionId: 'general', brandName: 'Northwind', blocks: { writingRules: '- Keep it to the facts.' } });
    expect(saved.prompt).toContain('## RULES\n- Keep it to the facts.\n');
    expect(saved.prompt).toContain('analyst for Northwind');
  });
  it('keeps its schema small and strict (three objects, every field required)', () => {
    const objects = []; const visit = (node) => { if (!node || typeof node !== 'object') return; if (node.type === 'object') { objects.push(node); expect(node.additionalProperties).toBe(false); expect(node.required.sort()).toEqual(Object.keys(node.properties).sort()); } for (const value of Object.values(node.properties || {})) visit(value); visit(node.items); };
    visit(SCAN_REPORT_SCHEMA);
    expect(objects).toHaveLength(3);
  });
  it('checks the answer: unknown trends and posts dropped, quotes word for word, a skipped trend filled from the scan', () => {
    const request = buildScanReportRequest({ scan, selection });
    const [first] = selection.posts;
    const output = validateScanReport({
      summary: 'Manual reporting is the loudest pain this morning.',
      trends: [
        { name: 'manual reporting.', whatsHappening: 'Teams describe hours of copy and paste.', whyItMatters: 'It eats planning time.', quotes: [{ evidenceId: first.ref, text: `“${first.text.slice(5, 40)}”` }, { evidenceId: first.ref, text: 'Words nobody wrote at all here.' }], evidenceIds: [first.ref, 'E99'] },
        { name: 'A trend we never found', whatsHappening: 'x', whyItMatters: 'y', quotes: [], evidenceIds: [] },
      ],
      watch: ['More agencies mention it', ''], nextSteps: ['Run full research'], caveats: [],
    }, request.context);
    expect(output.layout).toBe('quick-scan-report');
    expect(output.title).toBe('Quick scan report: reporting (2026-10-17)');
    expect(output.sections.map((section) => section.heading)).toEqual(['Manual reporting', 'Client churn', 'What to watch next', 'Next steps']);
    expect(output.sections[0].items).toEqual([{ label: 'Why it matters', text: 'It eats planning time.', evidenceIds: [] }, { label: 'Quote', text: `“${first.text.slice(5, 40).trim()}”`, evidenceIds: [first.id] }]);
    expect(output.sections[1]).toMatchObject({ body: 'Client churn, as the scan describes it.', items: [] });
    expect(output.sections[1].evidenceIds.length).toBeGreaterThan(0);
    expect(output.checks).toEqual({ droppedQuotes: 1, droppedRefs: 1, filledTrends: ['Client churn'] });
    expect(output.caveats[0]).toBe('The report skipped “Client churn”; its description comes from the scan.');
    expect(output.caveats.at(-1)).toBe('Based on 6 posts from the last 6 hours on X. A quick scan is a small sample; a full research run confirms a trend before it goes into a report.');
    expect(output.evidenceRegister[0]).toMatchObject({ id: first.id, url: first.url });
    // It renders as a report page, in Markdown and HTML.
    const markdown = content.renderContentExport(output);
    expect(markdown).toMatch(/^# Quick scan report: reporting \(2026-10-17\)/);
    expect(markdown).toContain('## Manual reporting');
    expect(content.renderContentExport(output, { format: 'html' })).toContain('<h2>Client churn</h2>');
  });
  it('asks for a repair when no trend is named, or the summary is empty', () => {
    const request = buildScanReportRequest({ scan, selection });
    expect(() => validateScanReport({ summary: 'x', trends: [{ name: 'Other' }], watch: [], nextSteps: [], caveats: [] }, request.context)).toThrow(/one entry per trend/);
    expect(() => validateScanReport({ summary: ' ', trends: [], watch: [], nextSteps: [], caveats: [] }, request.context)).toThrow(/summary is empty/);
  });
  it('keeps a source the content tools accept, so Create content and channel assets can start from the report', () => {
    const source = content.normalizeSource(scanSource(scan, selection));
    expect(source.kind).toBe('report');
    expect(source.evidence.length).toBe(selection.posts.length + 1);
  });
});

describe('estimate, window and samples', () => {
  it('prices the report from its model and the trends it will read', () => {
    const six = scanReportEstimate({ model: 'claude-opus-5-5', effort: 'high', themes: 6 });
    const three = scanReportEstimate({ model: 'claude-opus-5-5', effort: 'high', themes: 3 });
    expect(six).toBeGreaterThan(three);
    expect(scanReportEstimate({ model: 'claude-opus-5-5', effort: 'low', themes: 6 })).toBeLessThan(six);
  });
  it('words the window plainly', () => {
    expect([1, 6, 24, 72].map(windowLabel)).toEqual(['the last hour', 'the last 6 hours', 'the last 24 hours', 'the last 3 days']);
  });
  it('builds the bundled preview from the sample’s posts and trends, and every default passes its own checks', () => {
    const { scan, selection } = samplePayload(samples);
    expect(scan.themes.map((row) => row.name)).toEqual(samples.themes.map((row) => row.name));
    expect(selection.posts.length).toBeGreaterThan(0);
    for (const editionId of ['semrush', 'general']) expect(template.validateBlocks('reports.quick-scan', editionId, template.blocksFor('reports.quick-scan', editionId))).toEqual([]);
  });
});
