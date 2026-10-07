import { describe, expect, it } from 'vitest';
import { MARKETING_TEMPLATES, buildMarketingRecipe } from '../src/shared/marketing-templates.js';
import normalize from '../src/shared/normalize.js';
import reportPresets from '../src/shared/report-presets.json';

const values = { brand: 'Acme', decision: 'Which message is most distinctive?', audience: 'Enterprise marketers', sourceUrls: 'https://example.com/product' };
const build = (overrides = {}, templateId = 'competitor-positioning') => buildMarketingRecipe(templateId, { ...values, ...overrides });

describe('marketing collection boundaries', () => {
  it('deduplicates URLs and constrains a collection to precisely the supplied pages', () => {
    const recipe = build({ sourceUrls: ' HTTPS://EXAMPLE.COM/product#overview \nhttps://example.com/product\nhttps://competitor.com/pricing?plan=team\n' });
    expect(recipe.input.startUrls).toEqual([{ url: 'https://example.com/product' }, { url: 'https://competitor.com/pricing?plan=team' }]);
    expect(recipe.input).toMatchObject({ maxCrawlDepth: 0, maxCrawlPages: 2, maxResults: 2, respectRobotsTxtFile: true, summarize: false, maxConcurrency: 3, maxRequestRetries: 2 });
    expect(recipe.marketingBrief.sourceUrls).toEqual(recipe.input.startUrls.map(({ url }) => url));
    expect(recipe.runOptions).toEqual({ maxTotalChargeUsd: 2, timeoutSecs: 300 });
    expect(recipe.taskId).toBe('');
    expect(recipe.actorId).toBe('apify/website-content-crawler');
  });

  it.each(['file:///tmp/private.txt', 'ftp://example.com', 'javascript:alert(1)', 'example.com', 'https://user:secret@example.com', 'https://name@example.com', 'https:example.com'])('rejects unsupported or credentialed source %s', (url) => {
    expect(() => build({ sourceUrls: url })).toThrow();
    try { build({ sourceUrls: url }); } catch (error) { expect(error.field).toBe('sourceUrls'); }
  });

  it('requires at least one source and refuses more than fifteen distinct pages', () => {
    expect(() => build({ sourceUrls: '\n  ' })).toThrow('at least one');
    expect(() => build({ sourceUrls: Array.from({ length: 16 }, (_, i) => `https://example.com/${i}`) })).toThrow('15 different');
    expect(build({ sourceUrls: Array.from({ length: 15 }, (_, i) => `https://example.com/${i}`) }).input.maxCrawlPages).toBe(15);
  });

  it.each(['', 0, -1, 'NaN', Infinity, '2.005', 101, '0x2', true])('rejects an unsafe or ambiguous budget %s', (cap) => {
    expect(() => build({ maxTotalChargeUsd: cap })).toThrow('spending cap');
  });

  it('preserves the research context and chosen cap separately from crawler input', () => {
    const recipe = build({ brand: '  Acme launch  ', decision: '  Review the offer  ', audience: '  CMOs  ', maxTotalChargeUsd: '1.50' }, 'campaign-message-audit');
    expect(recipe.marketingBrief).toMatchObject({ brand: 'Acme launch', decision: 'Review the offer', audience: 'CMOs', templateId: 'campaign-message-audit', reportPresetId: 'campaign-message-audit', templateVersion: 1 });
    expect(recipe.runOptions.maxTotalChargeUsd).toBe(1.5);
    expect(recipe.input).not.toHaveProperty('maxTotalChargeUsd');
    expect(recipe.input).not.toHaveProperty('decision');
  });

  it('requires a project and a concrete decision and rejects unknown template IDs', () => {
    expect(() => build({ brand: '' })).toThrow('brand name');
    expect(() => build({ decision: '' })).toThrow('decision');
    expect(() => build({}, 'invented')).toThrow('available marketing template');
    expect(build({ audience: '' }).marketingBrief.audience).toBe('');
  });

  it('maps actual crawler content while retaining capture time without inventing a publication date', () => {
    const recipe = build();
    const item = normalize.normalizeItem({ url: 'https://example.com/product', markdown: '# Product\nAn explicit promise.', metadata: { author: 'Acme' }, crawl: { loadedTime: '2026-09-27T12:00:00Z' } }, { platform: recipe.platform, mapper: recipe.mapper });
    expect(item.text).toBe('# Product\nAn explicit promise.');
    expect(item.externalId).toBe('https://example.com/product');
    expect(item.author).toBe('Acme');
    expect(item.publishedAt).toBe('');
    expect(item.raw.crawl.loadedTime).toBe('2026-09-27T12:00:00Z');
  });

  it('has eight honest playbooks with matching report presets and substantive outlines', () => {
    expect(MARKETING_TEMPLATES.map(({ id }) => id)).toEqual(['competitor-positioning', 'campaign-message-audit', 'launch-research', 'account-research', 'voice-of-customer', 'content-opportunity', 'ad-creative-research', 'weekly-competitor-changes']);
    for (const template of MARKETING_TEMPLATES) {
      expect(reportPresets.some((preset) => preset.id === template.id)).toBe(true);
      expect(template.sections.length).toBeGreaterThanOrEqual(3);
      expect(template.sections.every(({ title, description }) => title && description)).toBe(true);
      expect(template.inputSummary).toBeTruthy();
      expect(template.scope).toBeTruthy();
      if (template.supportsPublicPages) {
        const recipe = build({ brandProfile: { id: 'acme', name: 'Acme', icp: 'Enterprise teams' } }, template.id);
        expect(recipe.marketingBrief.reportPresetId).toBe(template.id);
      } else expect(() => build({}, template.id)).toThrow('existing data or snapshot comparison');
    }
  });

  it('requires explicit ICP context for the account playbook', () => {
    expect(() => build({}, 'account-research')).toThrow('ideal customer profile');
    expect(() => build({ brandProfile: { name: 'Acme', icp: '  ' } }, 'account-research')).toThrow('ideal customer profile');
  });

  it('stores a detached snapshot of the chosen brand rather than a mutable profile reference', () => {
    const profile = { id: 'brand-1', name: 'Acme', offering: 'Research software', audience: 'Marketers', positioning: 'Clear evidence', icp: 'Enterprise marketing teams', brandVoice: 'Direct', forbiddenClaims: 'Guaranteed ROI', competitors: [{ name: 'Other', domain: 'other.example' }] };
    const recipe = build({ brandProfile: profile });
    expect(recipe.marketingBrief.brandProfileId).toBe('brand-1');
    expect(recipe.marketingBrief.brandContext).toEqual(profile);
    profile.offering = 'Changed'; profile.competitors[0].name = 'Changed';
    expect(recipe.marketingBrief.brandContext.offering).toBe('Research software');
    expect(recipe.marketingBrief.brandContext.competitors[0].name).toBe('Other');
    expect(build().marketingBrief).not.toHaveProperty('brandContext');
  });
});
