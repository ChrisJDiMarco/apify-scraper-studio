const { createHash } = require('node:crypto');
const Papa = require('papaparse');

const PLATFORMS = ['linkedin', 'x', 'reddit'];
const PERIODS = [1, 7, 14, 30, 90];
const DAY = 86400000;
const MAX_IMPORT = 30000;
const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ');
const platformOf = (value) => ({ twitter: 'x', 'twitter/x': 'x', 'x (twitter)': 'x' }[lower(value)] || lower(value));

function names(values, max) {
  if (!Array.isArray(values) || values.length > max || values.some((value) => typeof value !== 'string' || text(value).length > 120)) throw new Error(`Enter up to ${max} names or phrases of 120 characters each.`);
  const unique = new Map(values.map((value) => [lower(value), text(value)]));
  unique.delete('');
  return [...unique.values()];
}

function validateTracking(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Choose tracking settings.');
  const terms = names(config.terms || [], 50);
  const rows = config.brands || [];
  if (!Array.isArray(rows) || rows.length > 15) throw new Error('Track up to 15 brands, including your own.');
  const brands = rows.map((row) => {
    const name = typeof row?.name === 'string' ? text(row.name) : '';
    if (!name || name.length > 120) throw new Error('Every tracked brand needs a name of up to 120 characters.');
    return { name, aliases: names([name, ...(Array.isArray(row.aliases) ? row.aliases : [])], 20) };
  });
  const aliases = brands.flatMap((brand) => brand.aliases.map(lower));
  if (new Set(aliases).size !== aliases.length) throw new Error('Give each alias to only one tracked brand.');
  if (config.enabled && (!terms.length || brands.length < 2)) throw new Error('Add at least one topic keyword, your brand, and a competitor.');
  if (config.source && !['program', 'import'].includes(config.source)) throw new Error('Choose program collections or an imported tracker export.');
  return { enabled: config.enabled === true, source: config.source || 'program', terms, brands };
}

function sourceUrl(value) {
  if (!value || String(value).length > 2048) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(gclid|fbclid|trk)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}

function publicationTime(value) {
  const input = text(value);
  const iso = input.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2})?/);
  if (iso && !day(iso[1])) return NaN;
  const localIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
  return Date.parse(localIso.test(input) ? `${input.replace(' ', 'T')}Z` : input);
}

function normalizePost(row) {
  if (!row || typeof row !== 'object') return null;
  const platform = platformOf(row.platform);
  const rawTitle = platform === 'reddit' ? text(row.raw?.title) : '';
  const content = text(row.text);
  const body = rawTitle && !content.startsWith(rawTitle) ? [rawTitle, content].filter(Boolean).join('\n') : content;
  const type = lower(row.type);
  const publishedAt = publicationTime(row.publishedAt);
  if (!PLATFORMS.includes(platform) || !body || !Number.isFinite(publishedAt) || (type && !['post', 'tweet', 'submission', 'article', 'repost', 'quote'].includes(type))) return null;
  const url = sourceUrl(row.url);
  const id = text(row.externalId).slice(0, 500);
  const author = text(row.author).slice(0, 240);
  const published = new Date(publishedAt).toISOString();
  const identity = id || url || createHash('sha256').update(JSON.stringify([published, author, body])).digest('hex');
  return { id: `${platform}:${identity}`, platform, publishedAt: published, author, text: body.slice(0, 60000), url };
}

function csvPosts(csv) {
  if (typeof csv !== 'string' || !csv.trim() || Buffer.byteLength(csv) > 6 * 1024 * 1024) throw new Error('Choose a nonempty CSV of at most 6 MB.');
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (key) => key.trim().toLowerCase().replace(/[^a-z0-9]/g, '') });
  if (parsed.errors.length || Object.keys(parsed.meta.renamedHeaders || {}).length || !parsed.data.length || parsed.data.length > MAX_IMPORT) throw new Error(`Use a CSV with unique column names and 1 to ${MAX_IMPORT.toLocaleString()} well-formed rows.`);
  const rows = new Map();
  let skipped = 0;
  for (const row of parsed.data) {
    const post = normalizePost({ platform: row.platform || row.network || row.source, publishedAt: row.publishedat || row.postedat || row.createdat || row.date || row.timestamp, text: row.text || row.content || row.body || row.posttext, url: row.url || row.permalink || row.link || row.posturl, author: row.author || row.username, externalId: row.postid || row.externalid || row.id, type: row.type });
    if (!post) { skipped++; continue; }
    rows.set(post.id, post);
  }
  if (!rows.size) throw new Error('No usable posts. Include platform, publication date, and post text columns.');
  return { posts: [...rows.values()], skipped, duplicates: parsed.data.length - skipped - rows.size };
}

const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matcher = (values) => values.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${values.map((value) => escaped(lower(value))).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u') : /(?!)/;
const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
const utcDay = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

function postDateRange(posts) {
  let firstDate = ''; let lastDate = '';
  for (const post of posts) {
    const date = post.publishedAt.slice(0, 10);
    if (!firstDate || date < firstDate) firstDate = date;
    if (date > lastDate) lastDate = date;
  }
  return { firstDate, lastDate };
}

function trackingWindow(query = {}, latestDate = '', now = new Date()) {
  if ((query.end && !day(query.end)) || (query.start && !day(query.start))) throw new Error('Choose valid UTC dates.');
  const end = day(query.end) || latestDate || utcDay(now);
  const requested = Number(query.days);
  const days = PERIODS.includes(requested) ? requested : 7;
  const start = day(query.start) || utcDay(Date.parse(end) - (days - 1) * DAY);
  const span = (Date.parse(end) - Date.parse(start)) / DAY;
  if (span < 0 || span > 365) throw new Error('Choose a date range of up to 366 days.');
  return { start, end, span };
}

function previousTrackingWindow({ start, span }) {
  const first = Date.parse(start);
  return { start: utcDay(first - (span + 1) * DAY), end: utcDay(first - DAY) };
}

function trackingSummary(config, posts, query = {}, now = new Date(), dates = postDateRange(posts)) {
  const { start, end, span } = trackingWindow(query, dates.lastDate, now);
  const previous = previousTrackingWindow({ start, span });
  const topic = matcher(config.terms);
  const terms = config.terms.map((term) => matcher([term]));
  const checks = config.brands.map((brand) => matcher(brand.aliases));
  const platform = PLATFORMS.includes(query.platform) ? query.platform : '';
  const postPlatform = PLATFORMS.includes(query.postPlatform) ? query.postPlatform : '';
  const distinct = new Map();
  for (const post of posts) {
    const date = post.publishedAt.slice(0, 10);
    if (date >= previous.start && date <= end && (!platform || post.platform === platform)) distinct.set(post.id, post);
  }
  const selectedBrand = Number.isInteger(query.brand) && checks[query.brand] ? query.brand : -1;
  const selectedTopic = Number.isInteger(query.topic) && terms[query.topic] ? query.topic : -1;
  const offset = Math.max(0, Math.min(distinct.size, Math.floor(Number(query.offset)) || 0));
  const matches = [];
  const visibleCount = offset + 20;
  let matching = 0;
  const byNewest = (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
  const brandCounts = checks.map(() => 0);
  const previousBrandCounts = checks.map(() => 0);
  const byDay = new Map(Array.from({ length: span + 1 }, (_, index) => [utcDay(Date.parse(start) + index * DAY), { posts: 0, brands: checks.map(() => 0) }]));
  const perPlatform = (make) => Object.fromEntries(PLATFORMS.map((source) => [source, make()]));
  const platformCounts = perPlatform(() => 0);
  const brandPlatformCounts = perPlatform(() => checks.map(() => 0));
  const topics = config.terms.map((term) => ({ term, posts: 0, platforms: perPlatform(() => 0) }));
  const previousTopicCounts = terms.map(() => 0);
  const observedDays = perPlatform(() => new Set());
  let postsCount = 0;
  for (const post of distinct.values()) {
    const date = post.publishedAt.slice(0, 10);
    observedDays[post.platform].add(date);
    const content = lower(post.text);
    if (!topic.test(content)) continue;
    const matchedTopics = terms.flatMap((matches, index) => matches.test(content) ? [index] : []);
    if (date < start) {
      for (const index of matchedTopics) previousTopicCounts[index]++;
      for (let index = 0; index < checks.length; index++) if (checks[index].test(content)) previousBrandCounts[index]++;
      continue;
    }
    const row = byDay.get(date);
    const brands = [];
    for (let index = 0; index < checks.length; index++) if (checks[index].test(content)) {
      brands.push(index); brandCounts[index]++; row.brands[index]++; brandPlatformCounts[post.platform][index]++;
    }
    for (const index of matchedTopics) { topics[index].posts++; topics[index].platforms[post.platform]++; }
    postsCount++;
    row.posts++;
    platformCounts[post.platform]++;
    if ((!postPlatform || post.platform === postPlatform) && (selectedBrand < 0 || brands.includes(selectedBrand)) && (selectedTopic < 0 || matchedTopics.includes(selectedTopic))) {
      matching++;
      matches.push({ post, brands });
      if (matches.length >= visibleCount + 500) {
        matches.sort((a, b) => byNewest(a.post, b.post));
        matches.length = visibleCount;
      }
    }
  }
  matches.sort((a, b) => byNewest(a.post, b.post));
  // A post on every date for every observed platform is a conservative coverage check for a partial sample.
  const observed = PLATFORMS.filter((network) => observedDays[network].size > 0);
  const comparison = observed.length && observed.every((network) => observedDays[network].size === 2 * (span + 1))
    ? { ...previous, platforms: observed, brandCounts: previousBrandCounts, topicCounts: previousTopicCounts } : null;
  return { start, end, ...dates, postsCount, brandCounts, platformCounts, brandPlatformCounts, topics, comparison,
    series: [...byDay].map(([date, counts]) => ({ date, ...counts })),
    posts: matches.slice(offset, offset + 20).map(({ post, brands }) => ({ ...post, text: post.text.slice(0, 700), brands })), matches: matching, offset };
}

module.exports = { validateTracking, normalizePost, csvPosts, postDateRange, trackingWindow, previousTrackingWindow, trackingSummary };
