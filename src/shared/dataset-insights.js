// Local, no-AI views over a dataset's normalized items: signals, topics, and coverage.
// Pure functions so the Datasets tabs stay fast and testable.

const list = (value) => (Array.isArray(value) ? value : []);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function authorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return author;
  return author.name || author.username || author.handle || '';
}

export function engagement(item) {
  const m = item?.metrics || {};
  return num(m.likes) + num(m.comments) * 2 + num(m.shares) * 3;
}

function timestamp(item) {
  const time = Date.parse(item?.publishedAt || '');
  return Number.isFinite(time) ? time : null;
}

// Signals: filter, sort, and summarize posts for review.
export function buildSignals(items, { query = '', platform = 'all', type = 'all', sort = 'engagement', minEngagement = 0 } = {}) {
  const needle = query.trim().toLowerCase();
  const rows = list(items).map((item, index) => ({ item, index, score: engagement(item), time: timestamp(item), author: authorName(item?.author) }));
  const filtered = rows.filter(({ item, score, author }) => (platform === 'all' || (item?.platform || 'unknown') === platform)
    && (type === 'all' || (item?.type || 'post') === type)
    && score >= minEngagement
    && (!needle || `${item?.text || ''} ${author} ${item?.platform || ''} ${item?.url || ''}`.toLowerCase().includes(needle)));
  const sorters = {
    engagement: (a, b) => b.score - a.score || a.index - b.index,
    newest: (a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || a.index - b.index,
    oldest: (a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.index - b.index,
  };
  filtered.sort(sorters[sort] || sorters.engagement);
  return { rows: filtered, facets: facets(items) };
}

export function facets(items) {
  const count = (key) => {
    const map = new Map();
    for (const item of list(items)) { const value = item?.[key] || (key === 'type' ? 'post' : 'unknown'); map.set(value, (map.get(value) || 0) + 1); }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, total]) => ({ value, total }));
  };
  return { platforms: count('platform'), types: count('type') };
}

const STOPWORDS = new Set(`a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could couldn did didn do does doesn doing don down during each even ever every few for from further get gets getting got had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself just like ll made make makes many may me more most much must my myself need needs no nor not now of off on once one only or other our ours ourselves out over own really re same say says see she should shouldn so some still such than that the their theirs them themselves then there these they thing things think this those through to too under until up us use used using ve very via want wants was wasn way we well were weren what when where which while who whom why will with won would wouldn yes yet you your yours yourself yourselves anyone anything else everyone someone something lot lots kind sort actually maybe http https www com amp rt im its dont cant thats youre theyre ive`.split(/\s+/));

// Words in order, with filler words kept as null so phrases are only built from words that were truly adjacent.
function tokens(text) {
  return (String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[@#]/g, ' ').match(/[a-z0-9][a-z0-9'-]*/g) || [])
    .map((word) => word.replace(/'s$/, '').replace(/^'+|'+$/g, ''))
    .map((word) => (word.length > 2 && !STOPWORDS.has(word) && !/^\d/.test(word) ? word : null));
}

// Topics: terms and two-word phrases ranked by how many rows mention them (not raw repeats).
export function buildTopics(items, { mode = 'phrases', limit = 15 } = {}) {
  const rows = list(items);
  const docFreq = new Map();
  const examples = new Map();
  rows.forEach((item, index) => {
    const words = tokens(item?.text);
    const terms = new Set(mode === 'phrases' ? words.slice(1).map((word, i) => (word && words[i] && word !== words[i] ? `${words[i]} ${word}` : null)).filter(Boolean) : words.filter(Boolean));
    for (const term of terms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
      if (!examples.has(term)) examples.set(term, []);
      if (examples.get(term).length < 3) examples.get(term).push(index);
    }
  });
  const minimum = rows.length >= 20 ? 2 : 1;
  const ranked = [...docFreq.entries()].filter(([, total]) => total >= minimum).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  return { total: rows.length, topics: ranked.map(([term, total]) => ({ term, total, share: rows.length ? total / rows.length : 0, examples: examples.get(term).map((index) => rows[index]) })) };
}

// Coverage: what this dataset actually contains, and how trustworthy it is to analyze.
export function buildCoverage(items, now = Date.now()) {
  const rows = list(items);
  const times = rows.map(timestamp).filter((time) => time !== null).sort((a, b) => a - b);
  const authors = new Set(rows.map((item) => authorName(item?.author)).filter(Boolean));
  const withUrl = rows.filter((item) => item?.url).length;
  const withText = rows.filter((item) => String(item?.text || '').trim().length > 0).length;
  const totals = rows.reduce((sum, item) => { const m = item?.metrics || {}; return { likes: sum.likes + num(m.likes), comments: sum.comments + num(m.comments), shares: sum.shares + num(m.shares), views: sum.views + num(m.views) }; }, { likes: 0, comments: 0, shares: 0, views: 0 });
  const authorCounts = new Map();
  for (const item of rows) { const name = authorName(item?.author); if (name) authorCounts.set(name, (authorCounts.get(name) || 0) + 1); }
  const topAuthor = [...authorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total: rows.length,
    platforms: facets(rows).platforms,
    authors: authors.size,
    topAuthorShare: topAuthor && rows.length ? topAuthor[1] / rows.length : 0,
    topAuthor: topAuthor?.[0] || '',
    earliest: times.length ? new Date(times[0]).toISOString() : '',
    latest: times.length ? new Date(times.at(-1)).toISOString() : '',
    newestAgeDays: times.length ? Math.max(0, Math.floor((now - times.at(-1)) / 86400000)) : null,
    dated: times.length,
    withUrl,
    withText,
    engagement: totals,
  };
}

// Plain-language checks a researcher would want before trusting an analysis.
export function coverageChecks(coverage) {
  if (!coverage.total) return [];
  const pct = (value) => Math.round((value / coverage.total) * 100);
  const checks = [];
  checks.push(coverage.total >= 50 ? { tone: 'ready', text: `${coverage.total.toLocaleString()} rows is enough to spot patterns.` } : { tone: 'warning', text: `Only ${coverage.total} rows. Treat patterns as anecdotes until you collect more.` });
  checks.push(pct(coverage.dated) >= 80 ? { tone: 'ready', text: `${pct(coverage.dated)}% of rows have a date, so trends over time are meaningful.` } : { tone: 'warning', text: `${pct(coverage.dated)}% of rows have a date. Time-based comparisons will be incomplete.` });
  checks.push(pct(coverage.withUrl) >= 80 ? { tone: 'ready', text: `${pct(coverage.withUrl)}% of rows link back to their source.` } : { tone: 'warning', text: `${pct(coverage.withUrl)}% of rows have a source link, so some findings can’t be checked.` });
  if (coverage.topAuthorShare >= 0.25 && coverage.authors > 1) checks.push({ tone: 'warning', text: `${coverage.topAuthor} wrote ${Math.round(coverage.topAuthorShare * 100)}% of rows. One voice may be skewing results.` });
  else if (coverage.authors > 1) checks.push({ tone: 'ready', text: `${coverage.authors.toLocaleString()} distinct authors, with no single voice dominating.` });
  if (coverage.newestAgeDays !== null) checks.push(coverage.newestAgeDays <= 14 ? { tone: 'ready', text: `Newest row is ${coverage.newestAgeDays === 0 ? 'from today' : `${coverage.newestAgeDays} day${coverage.newestAgeDays === 1 ? '' : 's'} old`}.` } : { tone: 'warning', text: `Newest row is ${coverage.newestAgeDays} days old. Consider collecting fresh data.` });
  return checks;
}
