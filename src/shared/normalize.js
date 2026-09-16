const { redactSecrets, toId } = require('./recipe');

function firstString(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeMetrics(item) {
  const metrics = item.metrics && typeof item.metrics === 'object' ? item.metrics : item;
  return {
    likes: firstNumber(metrics, ['likes', 'likeCount', 'favoriteCount', 'upvotes', 'score']),
    comments: firstNumber(metrics, ['comments', 'commentCount', 'replies', 'replyCount', 'numComments']),
    shares: firstNumber(metrics, ['shares', 'shareCount', 'reposts', 'retweets', 'retweetCount']),
    views: firstNumber(metrics, ['views', 'viewCount', 'impressions']),
  };
}

function normalizeItem(item, context = {}) {
  const raw = item && typeof item === 'object' ? item : { value: item };
  const mapper = context.mapper || {};
  const textKeys = [mapper.text, 'text', 'body', 'content', 'caption', 'title', 'fullText'].filter(Boolean);
  const authorKeys = [mapper.author, 'authorName', 'author', 'username', 'userName', 'creator', 'subreddit'].filter(Boolean);
  const urlKeys = [mapper.url, 'url', 'postUrl', 'link', 'permalink', 'tweetUrl'].filter(Boolean);
  const idKeys = [mapper.externalId, 'id', 'postId', 'commentId', 'tweetId', 'urn'].filter(Boolean);

  return {
    id: `${context.runId || 'run'}:${firstString(raw, idKeys) || toId('item')}`,
    externalId: firstString(raw, idKeys),
    type: firstString(raw, [mapper.type, 'type', 'kind']).toLowerCase() || 'post',
    platform: context.platform || 'unknown',
    text: firstString(raw, textKeys),
    author: firstString(raw, authorKeys),
    url: firstString(raw, urlKeys),
    publishedAt: firstString(raw, [mapper.publishedAt, 'publishedAt', 'createdAt', 'date', 'timestamp', 'time'].filter(Boolean)),
    parentId: firstString(raw, [mapper.parentId, 'parentId', 'parent_id', 'parentCommentId'].filter(Boolean)),
    threadId: firstString(raw, [mapper.threadId, 'threadId', 'conversationId', 'postId'].filter(Boolean)),
    metrics: normalizeMetrics(raw),
    runId: context.runId || '',
    raw: redactSecrets(raw),
  };
}

function normalizeDataset(items, context = {}) {
  return (items || []).map((item) => normalizeItem(item, context));
}

function toJsonl(items) {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

function csvCell(value) {
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
  toJsonl,
};
