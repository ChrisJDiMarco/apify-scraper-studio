import { describe, expect, it } from 'vitest';
import normalize from '../src/shared/normalize.js';
import review from '../src/shared/report-review.js';
import findings from '../src/shared/findings-chat.js';
import recipes from '../src/shared/recipe.js';
import catalog from '../src/shared/source-catalog.js';

const { normalizeDataset, normalizeItem } = normalize;
const context = { runId: 'fixture-run', platform: 'linkedin', expandComments: true, maxComments: 2 };

describe('comment evidence from expanded source options', () => {
  it('preserves comment text, author, dates and source identity from documented LinkedIn fields', () => {
    const item = normalizeItem({ id: 'comment-1', type: 'comment', commentary: 'Reporting needs clearer source links.', actor: { name: 'Fixture researcher' }, linkedinUrl: 'https://www.linkedin.com/feed/update/fixture?commentUrn=comment-1', createdAt: '2026-09-25T12:00:00Z', postId: 'post-1' }, context);
    expect(item).toMatchObject({ id: 'fixture-run:comment-1', text: 'Reporting needs clearer source links.', type: 'comment', author: 'Fixture researcher', publishedAt: '2026-09-25T12:00:00Z', threadId: 'post-1' });
    expect(item.url).toContain('commentUrn=comment-1');
  });

  it('expands nested comments only when requested, bounded across comments and replies per post', () => {
    const posts = [{ id: 'post-1', text: 'Launch discussion', url: 'https://example.com/post', comments: [
      { id: 'comment-1', text: 'Needs a source', replies: [{ id: 'reply-1', commentary: { text: 'Here is the source' } }] },
      { id: 'comment-2', text: 'Outside the selected allowance' },
    ] }];
    expect(normalizeDataset(posts, { ...context, expandComments: false })).toHaveLength(1);
    const items = normalizeDataset(posts, context);
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ type: 'comment', parentId: 'post-1', threadId: 'post-1', url: 'https://example.com/post', urlBasis: 'parent-post' });
    expect(items[2]).toMatchObject({ text: 'Here is the source', parentId: 'comment-1', threadId: 'post-1' });
  });

  it('does not duplicate a comment also returned as a separate dataset row', () => {
    const comment = { id: 'comment-1', type: 'comment', text: 'One observation' };
    const items = normalizeDataset([{ id: 'post-1', text: 'Post', comments: [comment] }, comment], context);
    expect(items).toHaveLength(2);
    expect(items.map(item => item.id)).toEqual(['fixture-run:post-1', 'fixture-run:comment-1']);
  });

  it('uses comment identity instead of a parent postId and keeps comments without their own ID', () => {
    const items = normalizeDataset([{ id: 'post-1', text: 'Post', comments: [
      { commentId: 'comment-1', postId: 'post-1', text: 'First response' },
      { postId: 'post-1', text: 'Response without provider ID' },
    ] }], context);
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ id: 'fixture-run:comment-1', externalId: 'comment-1', parentId: 'post-1' });
    expect(items[2]).toMatchObject({ id: 'fixture-run:post-1:comment-2', externalId: '', parentId: 'post-1' });
  });

  it('does not turn reactions or numeric comment counts into invented speech', () => {
    const items = normalizeDataset([{ id: 'post-1', text: 'Post', comments: 7, reactions: [{ actor: { name: 'A person' }, type: 'LIKE' }] }], context);
    expect(items).toHaveLength(1);
    expect(items[0].metrics.comments).toBe(7);
    const unknown = normalizeItem({ type: 'reaction', actor: { name: 'A person' } }, context);
    expect(unknown.text).toBe('');
  });
  it('uses actual provider rows when deciding whether retrieval hit a limit', () => {
    const result = review.assessDatasetCoverage({ dataset: { collectionScope: { providerRows: 1, retrievalLimit: 2 } }, items: [1, 2, 3].map(id => ({ id: String(id), text: 'Evidence ' + id, url: 'https://example.com/' + id })) });
    expect(result.warnings.some(warning => warning.id === 'collection-limit-reached')).toBe(false);
  });

  it('includes selected source and timeframe context in chat without turning it into completeness evidence', () => {
    const context = findings.buildFindingsContext({ datasets: [{ dataset: { id: 'd', searchContext: { sourceId: 'x', query: 'marketing', targetSummary: '@fixture', sourceUrls: ['https://x.com/fixture'], dateSemantics: 'UTC dates are inclusive', sourceOptions: { startDate: '2026-09-01', endDate: '2026-09-27', replies: 'only' } } }, items: [{ id: 'one', text: 'Source text' }] }], question: 'What did people say?' });
    expect(context.prompt).toContain('requested filters, not a completeness guarantee');
    expect(context.prompt).toContain('@fixture');
    expect(context.prompt).toContain('https://x.com/fixture');
    expect(context.prompt).toContain('2026-09-01');
    expect(context.prompt).toContain('"replies":"only"');
  });

  it('recomputes the saved result ceiling instead of trusting forged context counts', () => {
    const input = catalog.buildSearchRecipes({ platformIds: ['linkedin-profile'], maxItems: 2, sourceOptions: { 'linkedin-profile': { urls: 'https://linkedin.com/in/fixture', includeComments: true, maxComments: 2 } } }).recipes[0];
    input.searchContext.maxResultItems = 999999;
    input.searchContext.maxItems = 999999;
    const saved = recipes.validateRecipe(input);
    expect(saved.searchContext).toMatchObject({ maxItems: 2, maxResultItems: 6 });
  });

});
