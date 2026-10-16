import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import workspaceModule from '../src/main/content-workspace.js';
import content from '../src/shared/content-studio.js';
import kit from '../src/shared/asset-kit.js';
import { jpeg, picture } from './helpers/pictures.js';
const { createContentWorkspace } = workspaceModule;
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const TREND = 'AI Citation Tracking ROI Breakdown';
const POST = { id: 'post-1', text: 'We still cannot prove ROI from AI citations.', url: 'https://x.com/someone/status/1', platform: 'x', author: 'someone', publishedAt: '2026-10-01' };

// A finished trend: its comprehensive report and editorial toolkit, written together by one research report run.
function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-kit-fixture-')); roots.push(root);
  const at = '2026-10-10T10:00:00.000Z';
  const space = (id, editionId) => ({ id, name: editionId === 'semrush' ? 'Semrush workspace' : 'Your workspace', editionId, knowledge: content.validateBrandKnowledge(editionId === 'semrush' ? content.SEMRUSH_KNOWLEDGE_PRESET : {}, { editionId }), products: [], createdAt: at, updatedAt: at });
  const asset = (id, deliverableId, title, channel) => ({ id, workspaceId: 'semrush', runId: 'content-trend', deliverableId, title, kind: 'text', channel, format: 'markdown', createdAt: at });
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ version: 1, activeWorkspaceId: 'semrush', workspaces: [space('general', 'general'), space('semrush', 'semrush')], programs: [], researchRuns: [], contentRuns: [{ id: 'content-trend', workspaceId: 'semrush', type: 'content', title: TREND, researchRunId: 'research-1', themeId: 'theme-citations', status: 'succeeded', stage: 'content', createdAt: at, maxBudgetUsd: 5, reservedUsd: 1, costUsd: 1, receipts: [], jobs: [{ id: 'evidence-report', status: 'succeeded' }, { id: 'editorial-toolkit', status: 'succeeded' }] }], themes: [], history: [], detections: [], assets: [asset('asset-report', 'evidence-report', `${TREND} — Comprehensive Trends Report`, 'Research'), asset('asset-toolkit', 'editorial-toolkit', `TREND: ${TREND}`, 'Strategy')], exports: [], datasetOwners: {} }));
  const dir = path.join(root, 'runs', 'content-trend'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify({ editionId: 'semrush', research: true, source: { id: 'theme-citations', kind: 'research-theme', title: TREND, text: 'Theme evidence package.', evidence: [POST], research: { themeId: 'theme-citations' } } }));
  const doc = (title, body, extra = {}) => ({ title, summary: `${title} summary.`, sections: [{ id: 'main', heading: 'What happened', body, items: [], evidenceIds: [], productIds: [] }], caveats: [], theme: { name: TREND }, ...extra });
  fs.writeFileSync(path.join(dir, 'asset-toolkit.json'), JSON.stringify(doc(`TREND: ${TREND}`, 'Toolkit: lead with the measurement gap.')));
  fs.writeFileSync(path.join(dir, 'asset-report.json'), JSON.stringify(doc(`${TREND} — Comprehensive Trends Report`, 'Report: practitioners cannot tie AI citations to revenue.', { evidenceRegister: [POST] })));
  return root;
}
const BRIEF = { headline: 'AI citations now decide which brands get seen', subtitle: 'What the data shows', callouts: [{ text: 'Teams cannot prove AI citation ROI', evidenceId: 'E1' }, { text: 'An invented statistic', evidenceId: 'E99' }], visualIdea: 'A search result fading into an AI answer card.', symbols: ['answer card', 'citation link'], avoid: ['charts without data'] };
// A schema-valid draft for whichever written deliverable the prompt asks for, or a picture brief.
function draft(request) {
  if (!request.schema.properties.sections) return BRIEF;
  const context = JSON.parse(request.prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1].split('\n\nYOUR PREVIOUS RESPONSE')[0]);
  const ids = request.schema.properties.sections.items.properties.id.enum;
  const descriptor = content.CONTENT_DELIVERABLES.find(value => value.kind === 'text' && JSON.stringify(value.sections.map(section => section.id)) === JSON.stringify(ids));
  const cite = context.source.evidence[0].id;
  return { title: `${descriptor.label} draft`, summary: 'Fixture summary.', sections: descriptor.sections.map(section => ({ id: section.id, heading: section.heading, body: 'Sourced fixture body.', items: Array.from({ length: section.minItems || 0 }, (_, i) => ({ label: `Item ${i + 1}`, text: 'Review it', evidenceIds: [cite], productIds: [] })), evidenceIds: [cite], productIds: [] })), caveats: ['Fixture only; no approved products were supplied.'], ...(descriptor.id === 'pr' ? { journalists: [] } : {}) };
}
const callKey = request => path.basename(request.outputPath || '', '.raw.json');
function harness({ runAI, generateImage = vi.fn(async ({ deliverable }) => deliverable.variantPrompts.map((_, i) => ({ title: `${deliverable.label} · ${i + 1}`, png: Buffer.from(png), receipt: { provider: 'fixture', costUsd: 0.04 } }))), publishCampaign, images = true, aiProvider = 'auto' } = {}) {
  const root = fixtureRoot(); const calls = []; let inFlight = 0; const peak = { text: 0 };
  const ai = vi.fn(async request => {
    calls.push(request); const text = Boolean(request.schema.properties.sections); if (text) peak.text = Math.max(peak.text, ++inFlight);
    try { await new Promise(resolve => setTimeout(resolve, 3)); return runAI ? await runAI(request) : { output: draft(request), receipt: { provider: 'fixture', costUsd: 0.05 } }; }
    finally { if (text) inFlight -= 1; }
  });
  const api = createContentWorkspace({ root, runAI: ai, generateImage: images ? generateImage : undefined, publishCampaign, capabilities: () => ({ aiProvider }), clock: () => new Date('2026-10-16T13:52:00.000Z') });
  return { root, api, ai, calls, peak, generateImage };
}
async function made(h, payload = { source: { kind: 'report', assetId: 'asset-toolkit' } }) { const run = h.api.createAssetKit(payload); await h.api.waitForIdle(); return h.api.readStudioRun({ runId: run.id }); }

describe('asset kits: every channel asset from one report', () => {
  it('plans the n8n channel folders for a trend, priced before anything is spent', () => {
    const h = harness(); const plan = h.api.planAssetKit({ source: { kind: 'report', assetId: 'asset-report' } });
    expect(plan.title).toBe(TREND); expect(plan.sourceKey).toBe('theme:theme-citations'); expect(plan.sourceKind).toBe('trend'); expect(plan.evidenceCount).toBe(1);
    expect(plan.folders.map(folder => folder.name)).toEqual(['Semrush Blog', 'Semrush Newsletter', 'Semrush Paid Media', 'Semrush PR', 'Semrush Social Team', 'Affiliate Program', 'Enterprise Sales Enablement', 'Backlinko', 'Exploding Topics', 'Search Engine Land / MarTech']);
    const items = plan.folders.flatMap(folder => folder.items); expect(items).toHaveLength(15); expect(items.every(item => item.selected && item.available && item.usd > 0)).toBe(true);
    expect(items.filter(item => item.kind === 'image').map(item => item.label)).toEqual(['Social Team — Hero Graphic', 'Search Engine Land — Editorial Hero', 'Search Engine Land — Social Hero']);
    expect(plan.estimate.pictures).toBe(9); expect(plan.estimate.model).toBe('claude-fable-5-1'); expect(plan.estimate.capUsd).toBeGreaterThanOrEqual(plan.estimate.totalUsd * 2);
    expect(h.ai).not.toHaveBeenCalled(); expect(h.generateImage).not.toHaveBeenCalled();
  });

  it('writes every asset from both reports a few at a time, with briefs instead of the whole report in picture prompts', async () => {
    const h = harness(); const run = await made(h);
    expect(run.status).toBe('succeeded'); expect(run.message).toBe('All 15 assets are ready.'); expect(run.progress).toEqual({ completed: 15, total: 15 });
    expect(run.kit).toMatchObject({ sourceKey: 'theme:theme-citations', sourceKind: 'trend', sourceTitle: TREND, folderName: `Golden Thread — ${TREND} (2026-10-16)`, reportAssetId: 'asset-report', themeId: 'theme-citations' });
    expect(run.sourceAssetId).toBe('asset-report'); // the trend board shows "Creating assets" on the trend while it runs
    expect(run.jobs.map(job => job.folder)).toContain('Search Engine Land / MarTech'); expect(run.jobs.find(job => job.id === 'blogshort').label).toBe('Blog — Short News Update');
    const written = h.calls.filter(request => request.schema.properties.sections);
    expect(written).toHaveLength(12); expect(written.every(request => request.model === 'claude-fable-5-1' && request.effort === 'high')).toBe(true);
    const context = JSON.parse(written[0].prompt.split('UNTRUSTED_SOURCE_AND_BRAND_DATA:\n')[1]);
    expect(context.source.evidence[0].text).toContain('Toolkit: lead with the measurement gap.'); expect(context.source.evidence[0].text).toContain('Report: practitioners cannot tie AI citations to revenue.');
    expect(context.source.evidence[1]).toMatchObject({ id: 'E1', url: POST.url, platform: 'x' });
    expect(h.peak.text).toBeGreaterThan(1); expect(h.peak.text).toBeLessThanOrEqual(3);
    const briefs = h.calls.filter(request => !request.schema.properties.sections); expect(briefs).toHaveLength(3); expect(briefs.every(request => request.effort === 'medium')).toBe(true);
    const pictures = h.generateImage.mock.calls.map(([request]) => request.deliverable);
    expect(pictures.map(deliverable => deliverable.label).sort()).toEqual(['Search Engine Land — Editorial Hero', 'Search Engine Land — Social Hero', 'Social Team — Hero Graphic']);
    for (const deliverable of pictures) for (const prompt of deliverable.variantPrompts) { expect(prompt.length).toBeLessThan(6000); expect(prompt).toContain(`HEADLINE TEXT TO RENDER: "${BRIEF.headline}"`); expect(prompt).toContain('Teams cannot prove AI citation ROI'); expect(prompt).not.toContain('An invented statistic'); expect(prompt).not.toContain('Report: practitioners'); }
    const assets = h.api.publicState().assets.filter(asset => asset.runId === run.id);
    expect(assets.filter(asset => asset.kind === 'text')).toHaveLength(12); expect(assets.filter(asset => asset.kind === 'image')).toHaveLength(9);
    expect(assets.find(asset => asset.kind === 'image').title).toMatch(/^(Social Team — Hero Graphic|Search Engine Land — (Editorial|Social) Hero) · [123]$/);
  }, 30000);

  it('gives a draft that fails the checks one repair attempt', async () => {
    let first = true;
    const h = harness({ runAI: async request => { if (callKey(request) === 'output-ads' && first) { first = false; return { output: { title: 'Broken', summary: '', sections: [], caveats: [] }, receipt: { costUsd: 0.05 } }; } return { output: draft(request), receipt: { costUsd: 0.05 } }; } });
    const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['ads'] });
    expect(run.status).toBe('succeeded');
    const ads = h.calls.filter(request => callKey(request).startsWith('output-ads')); expect(ads.map(callKey)).toEqual(['output-ads', 'output-ads-repair']);
    expect(ads[1].prompt).toContain('YOUR PREVIOUS RESPONSE WAS REJECTED BY VALIDATION');
  });

  it('retries only unfinished assets and reuses a saved picture brief instead of paying for it again', async () => {
    let failSel = true;
    const generateImage = vi.fn(async ({ deliverable }) => {
      if (deliverable.id === 'sel-image' && failSel) { failSel = false; throw Object.assign(new Error('Fixture image outage'), { beforeDispatch: true }); }
      return deliverable.variantPrompts.map((_, i) => ({ title: `${deliverable.label} · ${i + 1}`, png: Buffer.from(png), receipt: { provider: 'fixture', costUsd: 0.04 } }));
    });
    const h = harness({ generateImage }); const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'brand-image', 'sel-image'] });
    expect(run.status).toBe('partial'); expect(run.message).toBe('Some assets need another try. Finished ones are saved.'); expect(run.progress).toEqual({ completed: 2, total: 3 });
    const before = h.calls.length;
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
    expect(h.calls.length).toBe(before); // nothing was written twice, and the brief was reused
    expect(h.calls.filter(request => callKey(request) === 'brief-sel-image')).toHaveLength(1);
  });

  it('downloads a run as the n8n folder tree, with the source alongside', async () => {
    const h = harness(); const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'bloglong', 'landingpage', 'brand-image', 'sel'] }); const exported = h.api.exportAssetKit({ runId: run.id });
    expect(path.basename(exported.path)).toBe(`Golden Thread — ${TREND} (2026-10-16)`); expect(exported.assetCount).toBe(7);
    expect(fs.readdirSync(exported.path).sort()).toEqual(['Search Engine Land - MarTech', 'Semrush Blog', 'Semrush Paid Media', 'Semrush Social Team', `Source — ${TREND}.md`]);
    expect(fs.readdirSync(path.join(exported.path, 'Semrush Blog')).sort()).toEqual([`Blog — Long-form Article — ${TREND} (2026-10-16).html`, `Blog — Long-form Article — ${TREND} (2026-10-16).md`, `Blog — Short News Update — ${TREND} (2026-10-16).html`, `Blog — Short News Update — ${TREND} (2026-10-16).md`]);
    const social = fs.readdirSync(path.join(exported.path, 'Semrush Social Team'));
    expect(social).toContain(`Social Team — Hero Graphic — ${TREND} — Variation 3 (2026-10-16).png`); expect(social).toContain(`Social Team — Hero Graphic — ${TREND} — Variation 3 (2026-10-16).svg`);
    expect(fs.readdirSync(path.join(exported.path, 'Semrush Paid Media'))).toContain(`Paid Media — Landing Page — ${TREND} (2026-10-16).html`);
    expect(fs.readFileSync(path.join(exported.path, `Source — ${TREND}.md`), 'utf8')).toContain('Toolkit: lead with the measurement gap.');
    // The Mac app saves straight into Downloads, numbering a second copy, without keeping an export record.
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-kit-downloads-')); roots.push(downloads);
    const exportsBefore = JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')).exports.length;
    const first = h.api.exportAssetKit({ runId: run.id }, { into: downloads }); const second = h.api.exportAssetKit({ runId: run.id }, { into: downloads });
    expect(path.dirname(first.path)).toBe(downloads); expect(path.basename(second.path)).toBe(`Golden Thread — ${TREND} (2026-10-16) (2)`);
    expect(fs.readdirSync(path.join(second.path, 'Semrush Blog'))).toHaveLength(4);
    expect(JSON.parse(fs.readFileSync(path.join(h.root, 'state.json'), 'utf8')).exports).toHaveLength(exportsBefore);
  });

  it('publishes to Google Drive with the n8n folder and file names', async () => {
    const publishCampaign = vi.fn(async request => ({ version: 1, campaignId: request.campaignId, status: 'succeeded', assets: [] }));
    const h = harness({ publishCampaign }); const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['blogshort', 'social', 'sel-image'] }); await h.api.publishStudioRun({ runId: run.id });
    const request = publishCampaign.mock.calls[0][0];
    expect(request.title).toBe(`Golden Thread — ${TREND} (2026-10-16)`);
    expect([...new Set(request.assets.map(asset => asset.channel))].sort()).toEqual(['Search Engine Land / MarTech', 'Semrush Blog', 'Semrush Social Team']);
    expect(request.assets.find(asset => asset.deliverableId === 'blogshort')).toMatchObject({ channel: 'Semrush Blog', docName: `Blog — Short News Update — ${TREND} (2026-10-16)` });
    expect(request.assets.filter(asset => asset.deliverableId === 'sel-image').map(asset => asset.title).sort()[0]).toBe(`Search Engine Land — Editorial Hero — ${TREND} — Variation 1 (2026-10-16)`);
  });

  it('groups pasted text by its content and leaves pictures out until they are turned on', async () => {
    const h = harness({ images: false }); h.api.selectContentWorkspace('general');
    const source = { kind: 'text', text: '# Zero-click searches keep rising\n\nPublishers report fewer clicks from AI answers.' };
    const plan = h.api.planAssetKit({ source });
    expect(plan.title).toBe('Zero-click searches keep rising'); expect(plan.sourceKey).toMatch(/^text:[a-f0-9]{16}$/); expect(plan.earlierRuns).toBe(0);
    expect(plan.folders.map(folder => folder.name)).toEqual(['Blog', 'Newsletter', 'Paid media', 'PR', 'Social', 'Partners', 'Sales enablement', 'Video', 'Trend editorial', 'News editorial']);
    const picture = plan.folders.flatMap(folder => folder.items).find(item => item.kind === 'image'); expect(picture).toMatchObject({ id: 'brand-image', available: false, selected: false, usd: null });
    expect(() => h.api.createAssetKit({ source, deliverableIds: ['blogshort', 'brand-image'] })).toThrow('Turn on pictures');
    const run = await made(h, { source, deliverableIds: ['blogshort', 'social'] });
    expect(run.status).toBe('succeeded'); expect(run.kit.folderName).toBe('Zero-click searches keep rising — channel assets (2026-10-16)'); expect(run.jobs.map(job => job.label)).toEqual(['Blog — short news update', 'Social — social captions and thread']);
    expect(h.api.planAssetKit({ source: { ...source, title: 'Same text, new title' } }).earlierRuns).toBe(1);
    const asset = h.api.publicState().assets.find(row => row.runId === run.id);
    expect(() => h.api.planAssetKit({ source: { kind: 'report', assetId: asset.id } })).toThrow('Choose a written report.');
    expect(h.api.planAssetKit({ source: { kind: 'run', runId: run.id } }).sourceKey).toBe(plan.sourceKey);
  });

  it('runs a whole kit on Codex, which reports no costs, without the cap starving later assets', async () => {
    const h = harness({ aiProvider: 'codex', runAI: async request => ({ output: draft(request), receipt: { provider: 'codex', requestedModel: 'CLI configuration', costUsd: null } }) });
    const plan = h.api.planAssetKit({ source: { kind: 'report', assetId: 'asset-toolkit' } });
    expect(plan.route).toBe('codex');
    const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, maxBudgetUsd: 3 }); // far below 15 calls' allowances
    expect(run.status).toBe('succeeded'); expect(run.ai.route).toBe('codex');
    expect(run.reservedUsd).toBeCloseTo(0.36); expect(run.costUsd).toBeCloseTo(0.36); // only the 9 pictures (OpenAI) are metered
    expect(run.receipts.filter(receipt => receipt.provider === 'codex').every(receipt => /Codex reports no cost/.test(receipt.costBasis))).toBe(true);
  }, 30000);

  it('files a Google Doc kit under the document, whatever its title becomes', () => {
    const h = harness();
    const plan = h.api.planAssetKit({ source: { kind: 'upload', title: 'Q4 trend brief', text: 'Brief body.', url: 'https://docs.google.com/document/d/abcdefghij1234567890/edit?tab=t.0', format: 'google-doc' } });
    expect(plan).toMatchObject({ sourceKey: 'gdoc:abcdefghij1234567890', sourceKind: 'google-doc', title: 'Q4 trend brief' });
  });
});

describe('asset kit names', () => {
  it('keeps n8n names in Drive and makes them safe on disk', () => {
    expect(kit.kitFileName({ deliverableId: 'sel', editionId: 'semrush', title: 'X', createdAt: '2026-10-16T13:52:00Z' })).toBe('Search Engine Land — News Update + Video Script — X (2026-10-16)');
    expect(kit.safeFileName('Search Engine Land / MarTech')).toBe('Search Engine Land - MarTech');
    expect(kit.cleanTitle('TREND: Branded AI Overviews Click Collapse')).toBe('Branded AI Overviews Click Collapse');
    expect(kit.cleanTitle('Branded AI Overviews Click Collapse — Comprehensive Trends Report')).toBe('Branded AI Overviews Click Collapse');
    expect(() => kit.validateImageBrief({ ...BRIEF, headline: 'Too short' }, { evidenceIds: ['E1'] })).toThrow('3–16 words');
  });
});

// n8n sent its picture prompts to the edits endpoint with the brand's style examples and the exact logo.
describe('brand reference images in kit pictures', () => {
  const brief = kit.validateImageBrief(BRIEF, { evidenceIds: ['E1'] });
  const set = id => ({ id, label: 'Fixture pictures', kind: 'image', size: '1536x1024', variants: 3 });
  const roles = (...list) => list.map(role => ({ role }));
  const input = { editionId: 'semrush', source: { id: 'brief', kind: 'text', title: TREND, text: 'Body.', evidence: [{ id: 'E1', text: POST.text, url: POST.url }] }, brandKnowledge: content.SEMRUSH_KNOWLEDGE_PRESET };
  const failOnce = id => { let fail = true; return vi.fn(async ({ deliverable }) => { if (deliverable.id === id && fail) { fail = false; throw Object.assign(new Error('Fixture image outage'), { beforeDispatch: true }); } return deliverable.variantPrompts.map((_, i) => ({ title: `${deliverable.label} · ${i + 1}`, png: Buffer.from(png), receipt: { provider: 'fixture', costUsd: 0.04 } })); }); };

  it('keeps the exact prompt and the omit-logos rule when a picture set has no reference images', () => {
    const plain = kit.kitImageDeliverable(set('brand-image'), brief, { editionId: 'semrush' });
    expect(kit.kitImageDeliverable(set('brand-image'), brief, { editionId: 'semrush', references: [] })).toEqual(plain); expect(plain.references).toBeUndefined();
    for (const prompt of plain.variantPrompts) { expect(prompt).toContain('Draw no logos or brand marks; leave a clean footer where an approved logo can be added later.'); expect(prompt).not.toMatch(/REFERENCE IMAGES|STYLE EXAMPLES|LOGO:/); }
    expect(kit.imageBriefRequest(set('sel-image'), input).prompt).toContain('fixed brand rules and sees nothing else, so it can only show the words and facts you give it.');
  });
  it('numbers style examples and the logo as attached: a visual family never copied, and the logo merged exactly in the footer', () => {
    const editorial = kit.kitImageDeliverable(set('sel-image'), brief, { editionId: 'semrush', references: roles('style', 'style', 'style', 'style', 'style', 'logo') });
    expect(editorial.variantPrompts).toHaveLength(3);
    for (const prompt of editorial.variantPrompts) {
      expect(prompt).toContain('REFERENCE IMAGES, attached in this order: images 1–5 are approved Search Engine Land style examples; image 6 is the approved Search Engine Land logo.');
      expect(prompt).toContain('use them as one visual family for palette, typography, texture and finish, never as layouts to copy. Do not reuse any example’s composition, headline, words, numbers, people or subject');
      expect(prompt).toContain('LOGO: merge the approved logo from image 6 into a clean footer area exactly as supplied, with identical letterforms, spacing, proportions and colors. Never redraw, restyle, recolor, crop, stretch, distort or replace it.');
      expect(prompt).toContain('lower right preferred, opposite the searchengineland.com label. Render no other logos or brand marks, including any in the style examples.');
      expect(prompt).toContain('Apart from the approved logo, render only the quoted text below and the footer label, spelled exactly; add no other words, numbers or claims, and copy no text from the reference images.');
      expect(prompt).not.toContain('Draw no logos');
    }
    const art = kit.imageBriefRequest(set('sel-image'), input, { references: roles('style', 'style', 'style', 'style', 'style', 'logo') }).prompt;
    expect(art).toContain('fixed brand rules, 5 approved style examples and the approved logo. It sees nothing else'); expect(art).toContain('never the layout or the story'); expect(art).toContain('never ask for another logo or wordmark');
  });
  it('still draws no logo with style examples alone, and places a logo sent alone', () => {
    const campaign = kit.kitImageDeliverable(set('brand-image'), brief, { editionId: 'semrush', references: roles('style', 'style') });
    expect(campaign.prompt).toContain('images 1–2 are approved Semrush style examples.'); expect(campaign.prompt).toContain('Draw no logos or brand marks, including any in the style examples; leave a clean footer where an approved logo can be added later.'); expect(campaign.prompt).not.toContain('LOGO:');
    expect(kit.imageBriefRequest(set('brand-image'), input, { references: roles('style', 'style') }).prompt).toContain('There is no approved logo, so the footer stays clean');
    const logoOnly = kit.kitImageDeliverable(set('brand-image'), brief, { editionId: 'general', references: roles('logo') });
    expect(logoOnly.prompt).toContain('REFERENCE IMAGES, attached in this order: image 1 is the approved logo.'); expect(logoOnly.prompt).toContain('LOGO: merge the approved logo from image 1'); expect(logoOnly.prompt).not.toContain('STYLE EXAMPLES');
  });
  it('prices the image input each reference image adds to every picture', () => {
    const plan = content.buildContentPlan({ ...input, deliverableIds: ['sel-image'], imageVariants: 3 }); const ai = { model: 'claude-fable-5-1', effort: 'high', concurrency: 3 };
    expect(kit.estimateKit({ plan, ai, references: { 'sel-image': 6 } }).items[0].usd - kit.estimateKit({ plan, ai }).items[0].usd).toBeCloseTo(3 * 6 * kit.KIT_REFERENCE_USD, 1);
  });
  it('keeps up to six reference images per picture set, checking what each file really is', () => {
    const h = harness(); const add = (family, role, data, name = 'example.png') => h.api.addBrandImage({ workspaceId: 'semrush', family, role, name, data });
    const first = add('sel-editorial', 'style', picture(1200, 630, 1), 'sel-style-example-01-link-building-agency.png').image;
    expect(first).toMatchObject({ family: 'sel-editorial', role: 'style', name: 'sel-style-example-01-link-building-agency.png', mime: 'image/png', extension: 'png', width: 1200, height: 630 });
    const stored = path.join(h.root, 'brand-images', 'semrush', `${first.id}.png`); expect(fs.readFileSync(stored).equals(picture(1200, 630, 1))).toBe(true);
    expect(h.api.readBrandImage({ workspaceId: 'semrush', imageId: first.id }).dataUrl).toBe(`data:image/png;base64,${picture(1200, 630, 1).toString('base64')}`);
    const view = () => h.api.publicState().workspaces.find(w => w.id === 'semrush').brandImageSets;
    expect(view().map(entry => [entry.id, entry.label, entry.images.length])).toEqual([['campaign', 'Semrush campaign graphics', 0], ['sel-editorial', 'Search Engine Land editorial heroes', 1], ['sel-social', 'Search Engine Land social graphics', 0]]);
    const logo = add('sel-editorial', 'logo', jpeg(331, 60), 'search-engine-land-logo-2026.jpg').image; expect(logo).toMatchObject({ role: 'logo', mime: 'image/jpeg', extension: 'jpg', width: 331, height: 60 });
    expect(() => add('sel-editorial', 'logo', picture(331, 60, 9))).toThrow('already have an approved logo');
    expect(() => add('sel-editorial', 'style', picture(1200, 630, 1))).toThrow('That picture is already in this set.');
    expect(() => add('sel-editorial', 'style', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toThrow('Choose a PNG, JPEG or WebP picture.');
    expect(() => add('sel-editorial', 'hero', picture(64, 64, 3))).toThrow('style example or the approved logo');
    expect(() => add('sel-elsewhere', 'style', picture(64, 64, 3))).toThrow('Choose a picture set from this workspace.');
    for (let shade = 2; shade <= 5; shade++) add('sel-editorial', 'style', picture(1200, 630, shade));
    expect(() => add('sel-editorial', 'style', picture(1200, 630, 6))).toThrow('hold up to 6 reference images');
    expect(() => h.api.setBrandImageRole({ workspaceId: 'semrush', imageId: first.id, role: 'logo' })).toThrow('already has an approved logo');
    h.api.setBrandImageRole({ workspaceId: 'semrush', imageId: logo.id, role: 'style' }); expect(h.api.setBrandImageRole({ workspaceId: 'semrush', imageId: first.id, role: 'logo' }).image.role).toBe('logo');
    expect(h.api.removeBrandImage({ workspaceId: 'semrush', imageId: first.id })).toEqual({ removed: first.id }); expect(fs.existsSync(stored)).toBe(false);
    expect(view().find(entry => entry.id === 'sel-editorial').images).toHaveLength(5);
    expect(() => h.api.readBrandImage({ workspaceId: 'semrush', imageId: first.id })).toThrow('no longer in this workspace');
    h.api.selectContentWorkspace('general');
    expect(() => h.api.addBrandImage({ workspaceId: 'general', family: 'sel-editorial', role: 'style', data: picture() })).toThrow('Choose a picture set from this workspace.');
    expect(h.api.publicState().workspaces.find(w => w.id === 'general').brandImageSets.map(entry => entry.id)).toEqual(['campaign']);
  });
  it('sends each picture set its reference images, style examples first and the logo last, and keeps them for a retry', async () => {
    const h = harness({ generateImage: failOnce('sel-image') }); const source = { kind: 'report', assetId: 'asset-toolkit' };
    const add = (family, role, data) => h.api.addBrandImage({ workspaceId: 'semrush', family, role, name: `${family}-${role}.png`, data }).image;
    const before = h.api.planAssetKit({ source }).folders.flatMap(folder => folder.items).find(item => item.id === 'sel-image').usd;
    const logo = picture(331, 60, 7); const styles = [picture(1200, 630, 1), picture(1200, 630, 2)];
    add('sel-editorial', 'logo', logo); add('sel-editorial', 'style', styles[0]); add('sel-editorial', 'style', styles[1]); add('campaign', 'style', picture(1536, 1024, 3));
    const items = h.api.planAssetKit({ source }).folders.flatMap(folder => folder.items).filter(item => item.kind === 'image');
    expect(items.map(item => [item.id, item.references])).toEqual([['brand-image', { style: 1, logo: 0 }], ['sel-image', { style: 2, logo: 1 }], ['sel-social-image', { style: 0, logo: 0 }]]);
    expect(items.find(item => item.id === 'sel-image').usd - before).toBeCloseTo(3 * 3 * kit.KIT_REFERENCE_USD, 1);
    const run = await made(h, { source, deliverableIds: ['brand-image', 'sel-image', 'sel-social-image'] });
    expect(run.status).toBe('partial'); expect(run.kit.references).toEqual({ 'brand-image': { style: 1, logo: 0 }, 'sel-image': { style: 2, logo: 1 } });
    const sent = id => h.generateImage.mock.calls.map(([request]) => request.deliverable).filter(deliverable => deliverable.id === id);
    const [editorial] = sent('sel-image');
    expect(editorial.references.map(ref => [ref.role, ref.mime])).toEqual([['style', 'image/png'], ['style', 'image/png'], ['logo', 'image/png']]);
    expect(editorial.references.map(ref => Buffer.from(ref.data))).toEqual([...styles, logo]);
    for (const prompt of editorial.variantPrompts) expect(prompt).toContain('images 1–2 are approved Search Engine Land style examples; image 3 is the approved Search Engine Land logo.');
    expect(sent('brand-image')[0].references).toHaveLength(1); expect(sent('brand-image')[0].prompt).toContain('Draw no logos or brand marks, including any in the style examples');
    expect(sent('sel-social-image')[0].references).toBeUndefined(); expect(sent('sel-social-image')[0].prompt).toContain('Draw no logos or brand marks; leave a clean footer');
    expect(h.calls.find(request => callKey(request) === 'brief-sel-image').prompt).toContain('fixed brand rules, 2 approved style examples and the approved logo.');
    expect(h.calls.find(request => callKey(request) === 'brief-sel-social-image').prompt).toContain('fixed brand rules and sees nothing else');
    // Settings change after the run started; the retry still sends the pictures it started with.
    for (const image of h.api.publicState().workspaces.find(w => w.id === 'semrush').brandImages) h.api.removeBrandImage({ workspaceId: 'semrush', imageId: image.id });
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).status).toBe('succeeded');
    const retried = sent('sel-image')[1];
    expect(retried.variantPrompts).toEqual(editorial.variantPrompts); expect(retried.references.map(ref => Buffer.from(ref.data))).toEqual([...styles, logo]);
  });
  it('stops a picture set before any spend when a reference image saved with its run is damaged, leaving Settings intact', async () => {
    const h = harness({ generateImage: failOnce('sel-image') }); const logo = picture(331, 60, 7);
    const saved = h.api.addBrandImage({ workspaceId: 'semrush', family: 'sel-editorial', role: 'logo', name: 'logo.png', data: logo }).image;
    const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['sel-image'] }); expect(run.status).toBe('failed');
    // The run folder is the Codex CLI's writable workspace: its copy shares nothing with the Settings picture.
    const copy = path.join(h.root, 'runs', run.id, 'reference-sel-image-1.png'); expect(fs.statSync(copy).nlink).toBe(1);
    fs.writeFileSync(copy, picture(331, 60, 8));
    expect(h.api.readBrandImage({ workspaceId: 'semrush', imageId: saved.id }).dataUrl).toBe(`data:image/png;base64,${logo.toString('base64')}`);
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    expect(h.api.readStudioRun({ runId: run.id }).jobs[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('A reference image saved with this run is missing or damaged') });
    expect(h.generateImage).toHaveBeenCalledTimes(1);
    const next = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['sel-image'] }); expect(next.status).toBe('succeeded');
    expect(Buffer.from(h.generateImage.mock.calls.at(-1)[0].deliverable.references[0].data)).toEqual(logo);
  });
  it('draws a run made before Settings kept reference images without them, so its saved pictures still match', async () => {
    const h = harness({ generateImage: failOnce('sel-image') }); h.api.addBrandImage({ workspaceId: 'semrush', family: 'sel-editorial', role: 'logo', name: 'logo.png', data: picture(331, 60, 7) });
    const run = await made(h, { source: { kind: 'report', assetId: 'asset-toolkit' }, deliverableIds: ['sel-image'] });
    fs.rmSync(path.join(h.root, 'runs', run.id, 'brand-references.json'));
    h.api.retryStudioRun({ runId: run.id }); await h.api.waitForIdle();
    const [, retried] = h.generateImage.mock.calls.map(([request]) => request.deliverable);
    expect(retried.references).toBeUndefined(); expect(retried.prompt).toContain('Draw no logos or brand marks; leave a clean footer');
  });
});
