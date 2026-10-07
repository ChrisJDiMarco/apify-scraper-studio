const { redactSecrets, toId } = require('./recipe');

function valueAtPath(source, key) {
  if (!source || typeof key !== 'string' || !key) return undefined;
  if (Object.hasOwn(source, key)) return source[key];
  return key.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((value, part) => (
    value != null && !['__proto__', 'prototype', 'constructor'].includes(part) && Object.hasOwn(Object(value), part)
      ? value[part] : undefined
  ), source);
}

function firstString(source, keys) {
  for (const key of keys.flat()) {
    const value = valueAtPath(source, key);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstNumber(source, keys) {
  for (const key of keys.flat()) {
    const rawValue = valueAtPath(source, key);
    if (rawValue == null || typeof rawValue === 'boolean' || String(rawValue).trim() === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeMetrics(item) {
  const metrics = item.metrics && typeof item.metrics === 'object' ? item.metrics : item.engagement && typeof item.engagement === 'object' ? item.engagement : item;
  return {
    likes: firstNumber(metrics, ['likes', 'numLikes', 'likeCount', 'favoriteCount', 'upvotes', 'upVotes', 'score']),
    comments: firstNumber(metrics, ['comments', 'commentCount', 'replies', 'replyCount', 'numComments', 'numberOfComments']),
    shares: firstNumber(metrics, ['shares', 'numShares', 'shareCount', 'reposts', 'retweets', 'retweetCount']),
    views: firstNumber(metrics, ['views', 'viewCount', 'impressions']),
  };
}

function normalizeItem(item, context = {}) {
  const raw = item && typeof item === 'object' ? item : { value: item };
  const mapper = context.mapper || {};
  const textKeys = [mapper.text, 'text', 'body', 'content', 'commentary', 'commentary.text', 'caption', 'title', 'fullText'].filter(Boolean);
  const authorKeys = [mapper.author, 'authorName', 'author', 'author.name', 'author.userName', 'actor.name', 'username', 'userName', 'creator', 'subreddit'].filter(Boolean);
  const urlKeys = [mapper.url, 'url', 'linkedinUrl', 'postUrl', 'link', 'permalink', 'tweetUrl'].filter(Boolean);
  const itemType = firstString(raw, [mapper.type, 'type', 'kind', 'dataType']).toLowerCase() || 'post';
  const idKeys = [mapper.externalId, 'id', 'commentId', ...(['comment', 'reply', 'reaction'].includes(itemType) ? [] : ['postId']), 'tweetId', 'urn'].filter(Boolean);

  return {
    id: `${context.runId || 'run'}:${firstString(raw, idKeys) || toId('item')}`,
    externalId: firstString(raw, idKeys),
    type: itemType,
    platform: context.platform || 'unknown',
    text: firstString(raw, textKeys),
    author: firstString(raw, authorKeys),
    url: firstString(raw, urlKeys),
    publishedAt: firstString(raw, [mapper.publishedAt, 'publishedAt', 'postedAt.date', 'postedAtISO', 'createdAt', 'date', 'timestamp', 'time'].filter(Boolean)),
    parentId: firstString(raw, [mapper.parentId, 'parentId', 'parent_id', 'parentCommentId', ...(['comment', 'reply'].includes(itemType) ? ['postId'] : [])].filter(Boolean)),
    threadId: firstString(raw, [mapper.threadId, 'threadId', 'conversationId', 'postId'].filter(Boolean)),
    metrics: normalizeMetrics(raw),
    runId: context.runId || '',
    raw: redactSecrets(raw),
  };
}

function normalizeDataset(items, context = {}) {
  const roots = (items || []).map((item) => normalizeItem(item, context));
  if (!context.expandComments) return roots;
  // Some Actors embed comments in post rows; others also emit them separately.
  // Only expand explicit comment/reply arrays and retain their source relationship.
  const seen = new Set(roots.filter(item => item.externalId).map(item => item.externalId));
  const result = [];
  const commentLimit = Math.max(0, Math.min(100, Number(context.maxComments) || 0));
  (items || []).forEach((raw, index) => {
    const root = roots[index];
    result.push(root);
    let remaining = commentLimit;
    function visit(comments, parent, depth) {
      if (!Array.isArray(comments) || depth > 3) return;
      for (let position = 0; position < comments.length && remaining > 0; position += 1) {
        const comment = comments[position];
        if (!comment || typeof comment !== 'object' || Array.isArray(comment)) continue;
        const normalized = normalizeItem({ ...comment, type: 'comment' }, { ...context, mapper: {} });
        if (!normalized.text) continue;
        if (normalized.externalId && seen.has(normalized.externalId)) continue;
        if (normalized.externalId) seen.add(normalized.externalId);
        remaining -= 1;
        const item = {
          ...normalized,
          id: normalized.externalId ? normalized.id : `${parent.id}:comment-${position + 1}`,
          type: 'comment',
          parentId: normalized.parentId || parent.externalId || parent.id,
          threadId: normalized.threadId || root.externalId || root.id,
          url: normalized.url || root.url,
          urlBasis: normalized.url ? 'comment' : 'parent-post',
        };
        result.push(item);
        visit(comment.replies, item, depth + 1);
      }
    }
    visit(raw?.comments, root, 0);
  });
  return result;
}

function toJsonl(items) {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

function spreadsheetSafeValue(value) {
  // Scraped text is data, even when its first characters look like a formula.
  return typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
}

function csvCell(value) {
  value = spreadsheetSafeValue(value);
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(items) {
  const columns = ['id', 'type', 'platform', 'author', 'text', 'url', 'publishedAt', 'parentId', 'threadId', 'likes', 'comments', 'shares', 'views'];
  const rows = (items || []).map((item) => [
    item.id,
    item.type,
    item.platform,
    item.author,
    item.text,
    item.url,
    item.publishedAt,
    item.parentId,
    item.threadId,
    item.metrics?.likes,
    item.metrics?.comments,
    item.metrics?.shares,
    item.metrics?.views,
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

module.exports = {
  toCsv,
  normalizeDataset,
  normalizeItem,
  normalizeMetrics,
  spreadsheetSafeValue,
  toJsonl,
};
