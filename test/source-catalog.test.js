import { describe, expect, it } from 'vitest';
import catalog from '../src/shared/source-catalog.js';
import normalizer from '../src/shared/normalize.js';
const { SOURCE_CATALOG, buildSearchRecipes } = catalog;
const request = { query: 'marketing analytics', platformIds: ['reddit', 'x', 'linkedin-search'] };

describe('verified multi-source adapters', () => {
  it('uses exactly the selected Actors, documented query keys, and explicit limits', () => {
    const plan = buildSearchRecipes(request);
    expect(plan.recipes.map(({ actorId }) => actorId)).toEqual(['trudax/reddit-scraper-lite', 'apidojo/twitter-scraper-lite', 'supreme_coder/linkedin-post']);
    expect(plan.totalMaxChargeUsd).toBe(0.75);
    expect(plan.totalRequestedItems).toBe(30);
    expect(plan.recipes[0].input).toMatchObject({ searches: ['marketing analytics'], startUrls: [], maxItems: 10, skipComments: true, searchPosts: true, searchUsers: false });
    expect(plan.recipes[1].input).toEqual({ searchTerms: ['marketing analytics'], maxItems: 10, sort: 'Latest', includeSearchTerms: true });
    expect(new URL(plan.recipes[2].input.urls[0]).searchParams.get('keywords')).toBe('marketing analytics');
    expect(plan.recipes[2].input).toMatchObject({ limitPerSource: 10, deepScrape: false, numComments: 0, numLikes: 0 });
    for (const recipe of plan.recipes) expect(recipe.runOptions).toEqual({ maxTotalChargeUsd: 0.25, timeoutSecs: 300 });
  });

  it('rejects a request below the live-discovered Reddit minimum without increasing the user limit', () => {
    const smallRequest = { ...request, maxItems: 2 };
    expect(() => buildSearchRecipes(smallRequest)).toThrow('Reddit requires at least 10');
    expect(smallRequest.maxItems).toBe(2);
    expect(buildSearchRecipes({ ...smallRequest, platformIds: ['x', 'linkedin-search'] }).totalRequestedItems).toBe(4);
    expect(SOURCE_CATALOG.find(({ id }) => id === 'reddit').minItems).toBe(10);
    expect(SOURCE_CATALOG.filter(({ id }) => id !== 'reddit').every(({ minItems }) => minItems === 1)).toBe(true);
  });

  it('encodes keyword content as a query value rather than extra LinkedIn URL parameters', () => {
    const { recipes } = buildSearchRecipes({ ...request, query: 'AI & marketing + analytics #tools ?sort=x', platformIds: ['linkedin-search'] });
    const url = new URL(recipes[0].input.urls[0]);
    expect([...url.searchParams.keys()]).toEqual(['keywords']);
    expect(url.searchParams.get('keywords')).toBe('AI & marketing + analytics #tools ?sort=x');
  });

  it('divides the profile allowance without treating the topic as a profile keyword search', () => {
    const plan = buildSearchRecipes({ ...request, platformIds: ['linkedin-profile'], sourceUrls: 'https://linkedin.com/in/person?trk=old\nhttps://www.linkedin.com/in/person/\nhttps://uk.linkedin.com/company/acme', maxItems: 5 });
    expect(plan.recipes[0].input).toMatchObject({ targetUrls: ['https://www.linkedin.com/in/person', 'https://www.linkedin.com/company/acme'], maxPosts: 2, scrapeComments: false, scrapeReactions: false });
    expect(plan.recipes[0].input).not.toHaveProperty('query');
    expect(plan.recipes[0].input).not.toHaveProperty('searchTerms');
    expect(plan.totalRequestedItems).toBe(4);
    expect(plan.recipes[0].searchContext).toMatchObject({ query: request.query, collectionMode: 'profiles', maxItems: 4, requestedMaxItems: 5 });
  });

  it.each(['https://linkedin.com.evil.test/in/person', 'https://user:pass@linkedin.com/in/person', 'file:///tmp/profile', 'https://www.linkedin.com/posts/some-post', 'https://www.linkedin.com/search/results/content/?keywords=a', 'linkedin.com/in/person'])('rejects unsafe or unsupported profile URL %s', (sourceUrls) => {
    expect(() => buildSearchRecipes({ ...request, platformIds: ['linkedin-profile'], sourceUrls })).toThrow();
  });

  it('requires profile targets and rejects more targets than the row allowance', () => {
    expect(() => buildSearchRecipes({ ...request, platformIds: ['linkedin-profile'] })).toThrow('at least one LinkedIn');
    expect(() => buildSearchRecipes({ ...request, platformIds: ['linkedin-profile'], sourceUrls: ['https://linkedin.com/in/a', 'https://linkedin.com/in/b'], maxItems: 1 })).toThrow('1 LinkedIn URLs');
  });

  it.each([0, -1, 51, 1.5, Infinity, '', true])('rejects invalid per-source limit %s', (maxItems) => {
    expect(() => buildSearchRecipes({ ...request, maxItems })).toThrow('1 and 50');
  });

  it.each([0, -1, 101, NaN, Infinity, '', 0.255, true])('rejects invalid per-source budget %s', (maxTotalChargeUsd) => {
    expect(() => buildSearchRecipes({ ...request, maxTotalChargeUsd })).toThrow('budget');
  });

  it('deduplicates source selection and computes four-source default ceilings correctly', () => {
    const plan = buildSearchRecipes({ ...request, platformIds: ['reddit', 'x', 'linkedin-search', 'linkedin-profile', 'reddit'], sourceUrls: 'https://linkedin.com/in/person' });
    expect(plan.requestedSourceCount).toBe(4);
    expect(plan.totalMaxChargeUsd).toBe(1);
    expect(plan.totalRequestedItems).toBe(40);
  });

  it('rejects missing topics, missing source selections, and unrecognized adapters', () => {
    expect(() => buildSearchRecipes({ ...request, query: '' })).toThrow('topic');
    expect(() => buildSearchRecipes({ ...request, platformIds: [] })).toThrow('source');
    expect(() => buildSearchRecipes({ ...request, platformIds: ['unknown'] })).toThrow('supported');
  });

  it('maps the live-verified LinkedIn search fields without confusing capture and publication times', () => {
    const source = SOURCE_CATALOG.find(({ id }) => id === 'linkedin-search');
    const result = normalizer.normalizeItem({
      urn: 'urn:li:activity:example123',
      text: 'Our team compared three attribution approaches.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:example123',
      postedAtTimestamp: 1790503200000,
      postedAtISO: '2026-09-27T10:00:00Z',
      authorName: 'Example Marketing Team',
      authorProfileUrl: 'https://www.linkedin.com/company/example-team',
      numLikes: 12,
      numComments: 3,
      numShares: 1,
      author: { name: 'Example Marketing Team' },
    }, { mapper: source.mapper, platform: source.platform });
    expect(source.outputMappingVerified).toBe(true);
    expect(result).toMatchObject({
      externalId: 'urn:li:activity:example123',
      text: 'Our team compared three attribution approaches.',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:example123',
      author: 'Example Marketing Team',
      publishedAt: '2026-09-27T10:00:00Z',
      platform: 'linkedin',
    });
    expect(result.raw.numLikes).toBe(12);
  });

  it('maps the verified nested profile output fields into readable source evidence', () => {
    const source = SOURCE_CATALOG.find(({ id }) => id === 'linkedin-profile');
    const result = normalizer.normalizeItem({ id: '123', content: 'A source-backed post', linkedinUrl: 'https://linkedin.com/posts/123', author: { name: 'Example Author' }, postedAt: { date: '2026-09-27T12:00:00Z' } }, { mapper: source.mapper });
    expect(result).toMatchObject({ externalId: '123', text: 'A source-backed post', url: 'https://linkedin.com/posts/123', author: 'Example Author', publishedAt: '2026-09-27T12:00:00Z' });
  });
});

const oneSource = (id, sourceOptions, extra = {}) => buildSearchRecipes({ query: 'analytics', platformIds: [id], sourceOptions: { [id]: sourceOptions }, ...extra });

describe('source targeting and supported collection controls', () => {
  it('scopes one Reddit community with the dedicated field and canonicalizes names', () => {
    const { recipes } = oneSource('reddit', { subreddits: 'https://old.reddit.com/r/marketing/?utm=test, r/MARKETING' });
    expect(recipes[0].input).toMatchObject({ searches: ['analytics'], startUrls: [], searchCommunityName: 'marketing' });
    expect(recipes[0].searchContext.sourceUrls).toEqual(['https://www.reddit.com/r/marketing/']);
  });

  it('scopes multiple subreddits with grouped native query operators instead of a global search', () => {
    const { recipes } = oneSource('reddit', { subreddits: ['marketing', 'r/SaaS'] }, { query: 'analytics OR attribution' });
    expect(recipes[0].input.searches).toEqual(['(analytics OR attribution) AND (subreddit:marketing OR subreddit:SaaS)']);
    expect(recipes[0].input).not.toHaveProperty('searchCommunityName');
    expect(recipes[0].searchContext.targetSummary).toBe('r/marketing, r/SaaS');
    expect(oneSource('reddit', { subreddits: 'marketing' }, { query: '' }).recipes[0].input.searches).toEqual(['(subreddit:marketing)']);
  });

  it('maps Reddit comments, date cutoffs and media options without making the overall item limit unlimited', () => {
    const { recipes } = oneSource('reddit', { subreddits: 'marketing', time: 'month', startDate: '2026-09-01', sort: 'top', includeComments: true, maxComments: 8, commentStartDate: '2026-09-05', searchComments: true, includeMediaLinks: false, includeNSFW: true });
    expect(recipes[0].input).toMatchObject({ time: 'month', postDateLimit: '2026-09-01', sort: 'new', skipComments: false, maxComments: 8, commentDateLimit: '2026-09-05', searchComments: true, includeMediaLinks: false, includeNSFW: true, maxItems: 10 });
    expect(recipes[0].searchContext.maxResultItems).toBe(10);
    expect(recipes[0].searchContext.warnings.join(' ')).toContain('share the total Reddit result limit');
  });

  it('keeps matching-comment search separate from unrequested post-thread comments', () => {
    const recipe = oneSource('reddit', { subreddits: 'marketing', searchComments: true, includeComments: false, maxComments: 8, commentStartDate: '2026-09-01' }).recipes[0];
    expect(recipe.input).toMatchObject({ searchComments: true, skipComments: true, maxComments: 8 });
    expect(recipe.input).not.toHaveProperty('commentDateLimit');
    expect(recipe.searchContext.warnings.join(' ')).toContain('does not filter matching-comment searches');
    expect(recipe.searchContext.sourceOptions.commentStartDate).toBe('2026-09-01');
  });

  it('maps X account, date and content controls into the documented search language', () => {
    const { recipes } = oneSource('x', { handles: '@apify\nhttps://twitter.com/NASA?x=1\napify', startDate: '2026-09-01', endDate: '2026-09-27', replies: 'exclude', media: 'images', includeRetweets: false, sort: 'Top' }, { query: 'research OR data' });
    expect(recipes[0].input).toEqual({ searchTerms: ['(research OR data) (from:apify OR from:NASA) since:2026-09-01 until:2026-09-28 -filter:replies filter:images -filter:nativeretweets'], maxItems: 10, sort: 'Top', includeSearchTerms: true });
    expect(recipes[0].searchContext.sourceOptions.handles).toEqual(['apify', 'NASA']);
    expect(recipes[0].input).not.toHaveProperty('twitterHandles');
  });

  it('handles inclusive single days, month ends and leap years without local-time shifts', () => {
    for (const [endDate, exclusive] of [['2024-02-29', '2024-03-01'], ['2026-12-31', '2027-01-01']]) {
      expect(oneSource('x', { handles: 'apify', startDate: endDate, endDate }, { query: '' }).recipes[0].input.searchTerms).toEqual([`from:apify since:${endDate} until:${exclusive}`]);
    }
  });

  it('collects chosen X conversations and describes narrowing filters', () => {
    const { recipes } = oneSource('x', { conversationUrls: ['https://twitter.com/apify/status/123?tracking=1', 'https://x.com/apify/status/123'], replies: 'only', media: 'videos', includeRetweets: true, sort: 'Latest + Top' }, { query: '' });
    expect(recipes[0].input.searchTerms).toEqual(['conversation_id:123 filter:replies filter:videos include:nativeretweets']);
    expect(recipes[0].searchContext.sourceOptions.conversationUrls).toEqual(['https://x.com/apify/status/123']);
    expect(oneSource('x', { conversationUrls: 'https://x.com/apify/status/123', handles: 'apify' }).recipes[0].searchContext.warnings.join(' ')).toContain('other participants can be excluded');
  });

  it('maps LinkedIn keyword engagement details and earliest date to the actual provider keys', () => {
    const { recipes } = oneSource('linkedin-search', { startDate: '2026-09-01', includeComments: true, maxComments: 7, includeReactions: true, maxReactions: 9, fetchDocumentDetails: true });
    expect(recipes[0].input).toMatchObject({ scrapeUntil: '2026-09-01', deepScrape: true, numComments: 7, numLikes: 9, fetchDocumentDetails: true, limitPerSource: 10 });
    expect(recipes[0].searchContext.maxResultItems).toBe(10);
    expect(() => oneSource('linkedin-search', {}, { query: '' })).toThrow('topic');
  });

  it('collects LinkedIn target-only accounts and separately bounds additional billable engagement rows', () => {
    const plan = oneSource('linkedin-profile', { urls: ['https://linkedin.com/in/person', 'https://linkedin.com/company/team'], startDate: '2026-09-01', includeComments: true, maxComments: 5, commentsPostedLimit: 'week', includeReactions: true, maxReactions: 3, includeReposts: true, includeQuotePosts: false, contextCountry: 'GB' }, { query: '', maxItems: 5 });
    expect(plan.recipes[0].input).toEqual({ targetUrls: ['https://www.linkedin.com/in/person', 'https://www.linkedin.com/company/team'], maxPosts: 2, scrapeComments: true, scrapeReactions: true, maxComments: 5, commentsPostedLimit: 'week', maxReactions: 3, postedLimitDate: '2026-09-01', includeQuotePosts: false, includeReposts: true, contextCountry: 'GB' });
    expect(plan.recipes[0].searchContext).toMatchObject({ maxItems: 4, requestedMaxItems: 5, maxResultItems: 36 });
    expect(plan.totalRequestedItems).toBe(36);
    expect(plan.totalRequestedPosts).toBe(4);
    expect(plan.totalMaxChargeUsd).toBe(0.25);
  });

  it('maps every documented profile relative window without substituting unsupported dates', () => {
    for (const postedLimit of ['any', '1h', '24h', 'week', 'month', '3months', '6months', 'year']) {
      expect(oneSource('linkedin-profile', { urls: 'https://linkedin.com/in/person', postedLimit }).recipes[0].input.postedLimit).toBe(postedLimit);
    }
    expect(() => oneSource('linkedin-profile', { urls: 'https://linkedin.com/in/person', postedLimit: 'month', startDate: '2026-09-01' })).toThrow('not both');
  });

  it.each([
    ['reddit', { subreddits: 'https://reddit.com.evil.test/r/marketing' }],
    ['reddit', { subreddits: 'marketing OR cats' }],
    ['reddit', { subreddits: ['marketing', 7] }],
    ['reddit', { subreddits: Array.from({ length: 21 }, (_, i) => `community${i}`) }],
    ['x', { handles: 'apify OR from:other' }],
    ['x', { handles: 'https://user:pass@x.com/apify' }],
    ['x', { handles: 'https://x.com:8080/apify' }],
    ['x', { handles: 'https://x.com/apify/status/123' }],
    ['x', { conversationUrls: 'https://evil.test/apify/status/123' }],
    ['x', { conversationUrls: 'https://x.com/apify/status/not-an-id' }],
    ['linkedin-profile', { urls: 'https://linkedin.com.evil.test/in/person' }],
    ['linkedin-profile', { urls: 'https://linkedin.com/in/person/nested' }],
  ])('rejects invalid target input for %s: %j', (id, options) => {
    expect(() => oneSource(id, options)).toThrow();
  });

  it.each([
    ['reddit', { time: 'yesterday' }], ['reddit', { sort: 'old' }], ['reddit', { includeComments: 'false' }],
    ['reddit', { includeComments: true, maxComments: 0 }], ['reddit', { includeComments: true, maxComments: 101 }],
    ['reddit', { startDate: '2026-02-30' }], ['reddit', { commentStartDate: '2026-9-1' }], ['reddit', { endDate: '2026-09-01' }],
    ['x', { replies: 'some' }], ['x', { media: 'audio' }], ['x', { includeRetweets: 1 }],
    ['x', { startDate: '2026-09-30', endDate: '2026-09-01' }], ['x', { endDate: '2026-09-27T12:00:00Z' }],
    ['linkedin-search', { includeReactions: true, maxReactions: 101 }], ['linkedin-search', { includeComments: true, maxComments: 1.5 }], ['linkedin-search', { endDate: '2026-09-01' }],
    ['linkedin-profile', { urls: 'https://linkedin.com/in/person', includeComments: true, maxComments: 0 }],
    ['linkedin-profile', { urls: 'https://linkedin.com/in/person', includeReactions: true, maxReactions: 0 }],
    ['linkedin-profile', { urls: 'https://linkedin.com/in/person', contextCountry: 'CA' }],
    ['linkedin-profile', { urls: 'https://linkedin.com/in/person', commentsPostedLimit: 'year' }],
  ])('rejects invalid or unsupported controls for %s: %j', (id, options) => {
    expect(() => oneSource(id, options)).toThrow();
  });

  it('rejects malformed option containers and preserves field-level error locations', () => {
    for (const sourceOptions of [null, [], true]) expect(() => buildSearchRecipes({ ...request, sourceOptions })).toThrow('object');
    for (const options of [null, [], false]) expect(() => oneSource('x', options)).toThrow('object');
    expect(() => buildSearchRecipes({ ...request, sourceOptions: { instagram: {} } })).toThrow('supported');
    try { oneSource('x', { startDate: '2026-02-31' }); } catch (error) { expect(error.field).toBe('sourceOptions.x.startDate'); }
  });

  it.each(['', 0, -1, 101, 1.5, 'bad', true, null])('restores bounded defaults for inactive counts %j instead of blocking collection', (count) => {
    for (const id of ['reddit', 'linkedin-search', 'linkedin-profile']) {
      const options = { includeComments: false, maxComments: count, ...(id !== 'reddit' ? { includeReactions: false, maxReactions: count } : {}), ...(id === 'linkedin-profile' ? { urls: 'https://linkedin.com/in/person' } : {}) };
      const recipe = oneSource(id, options).recipes[0];
      expect(recipe.searchContext.sourceOptions.maxComments).toBe(5);
      expect(recipe.searchContext.maxResultItems).toBe(10);
      if (id !== 'reddit') expect(recipe.searchContext.sourceOptions.maxReactions).toBe(5);
      if (id === 'reddit') expect(recipe.input).toMatchObject({ skipComments: true, maxComments: 0 });
      if (id === 'linkedin-search') expect(recipe.input).toMatchObject({ numComments: 0, numLikes: 0 });
      if (id === 'linkedin-profile') {
        expect(recipe.input).toMatchObject({ scrapeComments: false, scrapeReactions: false });
        expect(recipe.input).not.toHaveProperty('maxComments');
        expect(recipe.input).not.toHaveProperty('maxReactions');
      }
    }
  });

  it('preserves valid inactive detail counts and still validates counts for matching Reddit comments', () => {
    const recipe = oneSource('linkedin-profile', { urls: 'https://linkedin.com/in/person', includeComments: false, maxComments: 12, includeReactions: false, maxReactions: 8 }).recipes[0];
    expect(recipe.searchContext.sourceOptions).toMatchObject({ maxComments: 12, maxReactions: 8 });
    expect(() => oneSource('reddit', { includeComments: false, searchComments: true, maxComments: '' })).toThrow('1 to 100');
    expect(() => oneSource('linkedin-profile', { urls: 'https://linkedin.com/in/person', includeReactions: true, maxReactions: '' })).toThrow('1 to 100');
  });

  it('round-trips a legacy X request without silently changing repost semantics', () => {
    const context = buildSearchRecipes({ query: 'analytics', platformIds: ['x'] }).recipes[0].searchContext;
    expect(oneSource('x', context.sourceOptions).recipes[0].searchContext).toEqual(context);
    expect(context.sourceOptions).not.toHaveProperty('includeRetweets');
  });

  it('preserves all source settings and bounded limits when canonical options are round-tripped', () => {
    const first = oneSource('linkedin-profile', { urls: 'https://linkedin.com/in/person', includeComments: true, maxComments: 100, includeReactions: true, maxReactions: 100 }, { maxItems: 50 });
    const context = first.recipes[0].searchContext;
    const second = oneSource(context.sourceId, context.sourceOptions, { maxItems: context.requestedMaxItems });
    expect(second.recipes[0].searchContext).toEqual(context);
    expect(context.maxResultItems).toBe(10050);
  });
});
