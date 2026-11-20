import { describe, expect, it, vi } from 'vitest';
import setup from '../src/main/website-setup.js';

const fact = (text, ...refs) => ({ text, refs });
const official = { url: 'https://example.com/product', metadata: { title: 'Acme product' }, text: 'Acme makes illustration tools.' };

describe('website setup drafts', () => {
  it('normalizes a pasted domain and rejects credentials, local destinations and other protocols', () => {
    expect(setup.websiteRequest({ websiteMode: 'workspace', website: 'EXAMPLE.COM/product?campaign=x#pricing' }).url).toBe('https://example.com/product');
    for (const website of ['http://2130706433', 'http://[::1]', 'localhost', 'example.internal', 'https://me:pass@example.com', 'example.com:8080', 'file:///etc/hosts']) {
      expect(() => setup.websiteRequest({ websiteMode: 'program', website })).toThrow('public website URL');
    }
  });

  it('bounds collection and only accepts supported fields and products from crawled first-party pages', async () => {
    const request = setup.websiteRequest({ websiteMode: 'workspace', website: 'example.com/product' });
    const runRecipe = vi.fn(async ({ actorId }) => actorId.endsWith('content-crawler') ? { rawItems: [official, {
      url: 'https://example.com/blog', crawl: { loadedUrl: 'https://external.com/blog' }, text: 'Redirected content',
    }, { url: 'http://example.com/old-product', text: 'An HTTP-only product page.' }] } : { rawItems: [{ organicResults: [{ url: 'https://some-news.com/acme', description: 'A review' }] }] });
    const collected = await setup.collectWebsite(request, { runRecipe });
    expect(runRecipe).toHaveBeenCalledTimes(2);
    expect(runRecipe.mock.calls[0][0]).toMatchObject({
      input: {
        startUrls: [{ url: 'https://example.com/product' }, { url: 'https://example.com/' }],
        includeUrlGlobs: [{ glob: 'https://example.com/**' }, { glob: 'https://www.example.com/**' }, { glob: 'http://example.com/**' }, { glob: 'http://www.example.com/**' }],
        proxyConfiguration: { useApifyProxy: true },
        maxCrawlPages: 10,
        respectRobotsTxtFile: true,
      },
      runOptions: { timeoutSecs: 75 },
    });
    expect(collected.evidence.map((row) => row.url)).toEqual(['https://example.com/product', 'http://example.com/old-product', 'https://some-news.com/acme']);
    const draft = setup.cleanWebsiteDraft(request, { about: { company: fact('Acme', 'S1') }, knowledge: { audience: fact('Illustrators', 'S1'), voice: fact('Unsupported', 'S99') }, products: [
      { name: 'Acme Draw', ref: 'S1', capabilities: ['Vector paths'], affiliateEligible: true },
      { name: 'Acme Classic', ref: 'S2' },
      { name: 'Acme Write', ref: 'S3' },
    ] }, collected);
    expect(draft.knowledge).toMatchObject({ audience: 'Illustrators', voice: '' });
    expect(draft.products).toEqual([{ name: 'Acme Draw', url: official.url, description: '', capabilities: ['Vector paths'], affiliateEligible: false, segment: 'general', tools: [] }]);
    expect(draft.evidence).toEqual([{ url: official.url, kind: 'page', title: 'Acme product' }]);
  });

  it('reports a partial crawl and derives each suggested social target from its source URL', async () => {
    const request = setup.websiteRequest({ websiteMode: 'program', website: 'example.com' });
    const runRecipe = vi.fn(async ({ actorId }) => {
      if (actorId.endsWith('content-crawler')) throw new Error('site timeout');
      return { rawItems: [{ organicResults: [
        { url: 'https://x.com/AcmeArt/status/12345', title: 'Acme Art update' },
        { url: 'https://www.reddit.com/r/Illustration/comments/1234/example/', title: 'Illustration discussion' },
        { url: 'https://www.linkedin.com/company/acme-art', title: 'Acme Art company' },
      ] }] };
    });
    const collected = await setup.collectWebsite(request, { runRecipe });
    const draft = setup.cleanWebsiteDraft(request, { about: { focus: fact('Illustration tools', 'S2') }, sources: { x: [{ ref: 'S1', name: 'Acme Art', target: 'made-up' }, { ref: 'S2' }], linkedin: [{ ref: 'S3' }], reddit: [{ ref: 'S2' }] } }, collected);
    expect(draft.sources.x).toEqual([{ target: 'acmeart', name: 'Acme Art', why: '', url: 'https://x.com/AcmeArt/status/12345' }]);
    expect(draft.sources.reddit[0].target).toBe('illustration');
    expect(draft.sources.linkedin[0].target).toBe('https://www.linkedin.com/company/acme-art');
    expect(draft.warnings).toEqual(['The website returned no readable pages. Check the search results before saving.']);
  });

  it('returns an actionable error without evidence', async () => {
    const request = setup.websiteRequest({ websiteMode: 'program', website: 'example.com' });
    await expect(setup.collectWebsite(request, { runRecipe: async () => ({ rawItems: [] }) })).rejects.toThrow('No readable public sources');
  });
});
