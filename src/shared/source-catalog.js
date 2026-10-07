const SOURCE_CATALOG = require('./source-catalog-data.json');

const OPTION_KEYS = {
  reddit: ['subreddits', 'time', 'startDate', 'sort', 'searchComments', 'includeComments', 'maxComments', 'commentStartDate', 'includeMediaLinks', 'includeNSFW'],
  x: ['handles', 'startDate', 'endDate', 'sort', 'replies', 'media', 'includeRetweets', 'conversationUrls'],
  'linkedin-search': ['startDate', 'includeComments', 'maxComments', 'includeReactions', 'maxReactions', 'fetchDocumentDetails'],
  'linkedin-profile': ['urls', 'postedLimit', 'startDate', 'includeComments', 'maxComments', 'commentsPostedLimit', 'includeReactions', 'maxReactions', 'includeQuotePosts', 'includeReposts', 'contextCountry'],
};

function invalid(field, message) {
  const error = new Error(message);
  error.field = field;
  throw error;
}

function optionObject(value, sourceId) {
  const field = `sourceOptions.${sourceId}`;
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field, 'Source options must be an object.');
  for (const key of Object.keys(value)) if (!OPTION_KEYS[sourceId].includes(key)) invalid(`${field}.${key}`, `The ${sourceId} source does not support the ${key} option.`);
  return value;
}

function booleanOption(options, key, fallback, field) {
  if (options[key] === undefined) return fallback;
  if (typeof options[key] !== 'boolean') invalid(`${field}.${key}`, `Choose on or off for ${key}.`);
  return options[key];
}

function enumOption(options, key, values, fallback, field) {
  const value = options[key] === undefined ? fallback : options[key];
  if (!values.includes(value)) invalid(`${field}.${key}`, `Choose a supported ${key} option: ${values.join(', ')}.`);
  return value;
}

function numberOption(options, key, min, max, fallback, field) {
  const raw = options[key] === undefined ? fallback : options[key];
  const value = Number(raw);
  if (!/^[0-9]+$/.test(String(raw)) || !Number.isInteger(value) || value < min || value > max) invalid(`${field}.${key}`, `Choose ${min} to ${max} for ${key}.`);
  return value;
}

function collectionCount(options, key, enabled, field) {
  if (enabled) return numberOption(options, key, 1, 100, 5, field);
  // Hidden, inactive inputs must not block a run. Preserve a reusable valid limit,
  // otherwise restore the bounded default before this collection is enabled again.
  const raw = options[key];
  const value = Number(raw);
  return /^[0-9]+$/.test(String(raw)) && Number.isInteger(value) && value >= 1 && value <= 100 ? value : 5;
}

function dateOption(options, key, field) {
  const value = options[key];
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field}.${key}`, 'Choose a date in YYYY-MM-DD format.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 9998) invalid(`${field}.${key}`, 'Choose a valid calendar date.');
  return value;
}

function entries(value, field) {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' && !Array.isArray(value)) invalid(field, 'Enter one target per line or separate targets with commas.');
  const values = Array.isArray(value) ? value : value.split(/[,\r\n]+/);
  if (values.length > 200 || values.some((entry) => typeof entry !== 'string' || entry.length > 2000)) invalid(field, 'Enter a short list of valid targets.');
  return values.map((entry) => entry.trim()).filter(Boolean);
}

function uniqueTargets(values, field, limit = 20) {
  const seen = new Set();
  const result = values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (result.length > limit) invalid(field, `Use ${limit} targets or fewer for this source.`);
  return result;
}

function safeTargetUrl(raw, field, hosts) {
  let url;
  try { url = new URL(raw); } catch { invalid(field, 'Use complete public URLs starting with https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) invalid(field, 'Use a supported public platform URL without credentials.');
  return url;
}

function profileUrls(value, maxItems, field = 'sourceUrls') {
  const urls = entries(value, field).map((raw) => {
    const url = safeTargetUrl(raw, field, ['linkedin.com']);
    if (!/^\/(in|company)\/[^/]+\/?$/.test(url.pathname)) invalid(field, 'Use public linkedin.com/in/… or linkedin.com/company/… URLs.');
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.href;
  });
  const result = uniqueTargets(urls, field);
  if (!result.length) invalid(field, 'Add at least one LinkedIn profile or company URL.');
  if (result.length > maxItems) invalid(field, `Use ${maxItems} LinkedIn URLs or fewer so each can receive at least one result within your source limit.`);
  return result;
}

function subredditNames(value, field) {
  return uniqueTargets(entries(value, field).map((raw) => {
    let name = raw;
    if (/^https?:\/\//i.test(raw)) {
      const url = safeTargetUrl(raw, field, ['reddit.com']);
      const match = url.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/?$/);
      if (!match) invalid(field, 'Use subreddit names, r/name, or public Reddit community URLs.');
      name = match[1];
    } else name = raw.replace(/^\/?r\//i, '').replace(/\/$/, '');
    if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) invalid(field, 'Use subreddit names such as marketing or r/SaaS.');
    return name;
  }), field);
}

function xHandles(value, field) {
  return uniqueTargets(entries(value, field).map((raw) => {
    let name = raw.replace(/^@/, '');
    if (/^https?:\/\//i.test(raw)) {
      const url = safeTargetUrl(raw, field, ['x.com', 'twitter.com']);
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (!match) invalid(field, 'Use X account handles or profile URLs, not post URLs.');
      name = match[1];
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(name) || /^(home|search|explore|intent|settings|notifications|messages|i)$/i.test(name)) invalid(field, 'Use X account handles such as @apify or public profile URLs.');
    return name;
  }), field);
}

function conversationTargets(value, field) {
  const urls = entries(value, field).map((raw) => {
    const url = safeTargetUrl(raw, field, ['x.com', 'twitter.com']);
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/);
    if (!match) invalid(field, 'Use complete X post URLs to collect their conversation threads.');
    return `https://x.com/${match[1]}/status/${match[2]}`;
  });
  return uniqueTargets(urls, field);
}

function buildSearchRecipes(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) invalid('request', 'Enter a search request.');
  if (request.query !== undefined && typeof request.query !== 'string') invalid('query', 'Enter a topic, question, or search phrase.');
  const query = (request.query || '').trim();
  if (query.length > 500) invalid('query', 'Keep the search phrase to 500 characters or fewer.');
  if (!Array.isArray(request.platformIds) || !request.platformIds.length) invalid('platformIds', 'Choose at least one source.');
  const ids = [...new Set(request.platformIds)];
  const sources = ids.map((id) => SOURCE_CATALOG.find((source) => source.id === id));
  if (sources.some((source) => !source)) invalid('platformIds', 'Choose only the supported search sources.');
  if (request.sourceOptions !== undefined && (!request.sourceOptions || typeof request.sourceOptions !== 'object' || Array.isArray(request.sourceOptions))) invalid('sourceOptions', 'Source options must be an object.');
  for (const id of Object.keys(request.sourceOptions || {})) if (!Object.hasOwn(OPTION_KEYS, id)) invalid('sourceOptions', 'Choose only the supported search sources.');
  const rawLimit = request.maxItems ?? 10;
  const maxItems = Number(rawLimit);
  if (!/^\d+$/.test(String(rawLimit)) || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) invalid('maxItems', 'Choose between 1 and 50 results per source.');
  const minimumSource = sources.reduce((highest, source) => source.minItems > highest.minItems ? source : highest, sources[0]);
  if (maxItems < minimumSource.minItems) invalid('maxItems', `${minimumSource.name} requires at least ${minimumSource.minItems} results per source. Increase your result limit or deselect ${minimumSource.name}.`);
  const rawCap = request.maxTotalChargeUsd ?? 0.25;
  const maxTotalChargeUsd = Number(rawCap);
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(rawCap).trim()) || !Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd < 0.01 || maxTotalChargeUsd > 100) invalid('maxTotalChargeUsd', 'Enter an Apify budget from $0.01 to $100 per source, with at most two decimal places.');

  const recipes = sources.map((source) => {
    const options = optionObject(request.sourceOptions?.[source.id], source.id);
    const field = `sourceOptions.${source.id}`;
    let input;
    let actualItems = maxItems;
    let maxResultItems = maxItems;
    let sourceUrls = [];
    let sourceOptions;
    let targetSummary;
    let dateSemantics = 'All available dates, subject to platform search coverage.';
    const warnings = [];

    if (source.id === 'reddit') {
      const subreddits = subredditNames(options.subreddits, `${field}.subreddits`);
      if (!query && !subreddits.length) invalid('query', 'Enter a topic or add at least one subreddit.');
      const time = enumOption(options, 'time', ['all', 'hour', 'day', 'week', 'month', 'year'], 'all', field);
      const startDate = dateOption(options, 'startDate', field);
      const commentStartDate = dateOption(options, 'commentStartDate', field);
      const selectedSort = enumOption(options, 'sort', ['relevance', 'hot', 'top', 'new', 'rising', 'comments'], 'relevance', field);
      const sort = startDate ? 'new' : selectedSort;
      const searchComments = booleanOption(options, 'searchComments', false, field);
      const includeComments = booleanOption(options, 'includeComments', false, field);
      const maxComments = collectionCount(options, 'maxComments', includeComments || searchComments, field);
      const includeMediaLinks = booleanOption(options, 'includeMediaLinks', true, field);
      const includeNSFW = booleanOption(options, 'includeNSFW', false, field);
      let search = query;
      if (subreddits.length > 1 || (!query && subreddits.length)) {
        const scope = subreddits.map((name) => `subreddit:${name}`).join(' OR ');
        search = query ? `(${query}) AND (${scope})` : `(${scope})`;
      }
      input = { searches: [search], startUrls: [], searchPosts: true, searchComments, searchCommunities: false, searchUsers: false, searchMedia: false, skipComments: !includeComments, skipCommunity: true, maxComments: includeComments || searchComments ? maxComments : 0, maxItems, maxPostCount: maxItems, sort, includeMediaLinks, includeNSFW, proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } };
      if (subreddits.length === 1 && query) input.searchCommunityName = subreddits[0];
      if (options.time !== undefined || time !== 'all') input.time = time;
      if (startDate) input.postDateLimit = startDate;
      if (commentStartDate && includeComments) input.commentDateLimit = commentStartDate;
      sourceUrls = subreddits.map((name) => `https://www.reddit.com/r/${name}/`);
      sourceOptions = { subreddits, time, startDate, sort, searchComments, includeComments, maxComments, commentStartDate, includeMediaLinks, includeNSFW };
      targetSummary = subreddits.length ? subreddits.map((name) => `r/${name}`).join(', ') : 'All Reddit communities';
      dateSemantics = 'Reddit time presets filter posts only. Custom post and comment dates mean newer than that date; there is no custom end date.';
      if (includeComments || searchComments) warnings.push('Posts and comments share the total Reddit result limit; this does not collect every reply.');
      if (searchComments && time !== 'all') warnings.push('The relative time filter applies to posts, not matching comments. Use the comment date field for thread comments.');
      if (startDate) warnings.push('A custom post start date makes the Actor sort by New.');
      if (commentStartDate && !includeComments) warnings.push('The saved thread-comment date has no effect while thread comment collection is off; it does not filter matching-comment searches.');
    }

    if (source.id === 'x') {
      const handles = xHandles(options.handles, `${field}.handles`);
      const conversationUrls = conversationTargets(options.conversationUrls, `${field}.conversationUrls`);
      if (!query && !handles.length && !conversationUrls.length) invalid('query', 'Enter a topic or add an X account or conversation URL.');
      const startDate = dateOption(options, 'startDate', field);
      const endDate = dateOption(options, 'endDate', field);
      if (startDate && endDate && startDate > endDate) invalid(`${field}.endDate`, 'Choose an end date on or after the start date.');
      const sort = enumOption(options, 'sort', ['Latest', 'Top', 'Latest + Top'], 'Latest', field);
      const replies = enumOption(options, 'replies', ['all', 'exclude', 'only'], 'all', field);
      const media = enumOption(options, 'media', ['all', 'media', 'images', 'videos', 'links'], 'all', field);
      const includeRetweets = booleanOption(options, 'includeRetweets', true, field);
      const filters = [];
      if (handles.length) filters.push(handles.length === 1 ? `from:${handles[0]}` : `(${handles.map((name) => `from:${name}`).join(' OR ')})`);
      if (startDate) filters.push(`since:${startDate}`);
      if (endDate) filters.push(`until:${new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86400000).toISOString().slice(0, 10)}`);
      if (replies !== 'all') filters.push(`${replies === 'exclude' ? '-' : ''}filter:replies`);
      if (media !== 'all') filters.push(`filter:${media}`);
      if (options.includeRetweets !== undefined) filters.push(includeRetweets ? 'include:nativeretweets' : '-filter:nativeretweets');
      const prefix = query ? (filters.length || conversationUrls.length ? `(${query})` : query) : '';
      const searchTerms = (conversationUrls.length ? conversationUrls : ['']).map((url) => [prefix, url ? `conversation_id:${url.split('/').at(-1)}` : '', ...filters].filter(Boolean).join(' '));
      input = { searchTerms, maxItems, sort, includeSearchTerms: true };
      sourceUrls = [...handles.map((name) => `https://x.com/${name}`), ...conversationUrls];
      sourceOptions = { handles, conversationUrls, startDate, endDate, sort, replies, media, ...(options.includeRetweets === undefined ? {} : { includeRetweets }) };
      targetSummary = [...handles.map((name) => `@${name}`), ...(conversationUrls.length ? [`${conversationUrls.length} conversation thread${conversationUrls.length === 1 ? '' : 's'}`] : [])].join(', ') || 'All public X search';
      dateSemantics = 'Both selected dates include the whole UTC day. The end date is sent as the next day with the exclusive until search operator.';
      if (conversationUrls.length && (query || handles.length)) warnings.push('Topic and account filters also narrow the selected conversation threads, so other participants can be excluded.');
      if (conversationUrls.length && replies === 'exclude') warnings.push('Excluding replies can leave conversation threads with few or no results.');
      if (includeRetweets && options.includeRetweets !== undefined) warnings.push('X limits native repost search coverage, especially for older dates. Reposts are requested but not guaranteed.');
      if (sort === 'Latest + Top') warnings.push('Latest + Top may return duplicate posts.');
    }

    if (source.id === 'linkedin-search') {
      if (!query) invalid('query', 'Enter a topic for LinkedIn keyword search, or choose LinkedIn accounts for target-only collection.');
      const startDate = dateOption(options, 'startDate', field);
      const includeComments = booleanOption(options, 'includeComments', false, field);
      const includeReactions = booleanOption(options, 'includeReactions', false, field);
      const maxComments = collectionCount(options, 'maxComments', includeComments, field);
      const maxReactions = collectionCount(options, 'maxReactions', includeReactions, field);
      const fetchDocumentDetails = booleanOption(options, 'fetchDocumentDetails', false, field);
      const searchUrl = new URL('https://www.linkedin.com/search/results/content/');
      searchUrl.searchParams.set('keywords', query);
      sourceUrls = [searchUrl.href];
      input = { urls: sourceUrls, limitPerSource: maxItems, deepScrape: includeComments || includeReactions || fetchDocumentDetails, fetchDocumentDetails, numComments: includeComments ? maxComments : 0, numLikes: includeReactions ? maxReactions : 0, rawData: false };
      if (startDate) input.scrapeUntil = startDate;
      sourceOptions = { startDate, includeComments, maxComments, includeReactions, maxReactions, fetchDocumentDetails };
      targetSummary = 'LinkedIn content search';
      dateSemantics = 'The start date means posts newer than that date. This Actor does not offer a custom end date.';
      if (includeComments || includeReactions || fetchDocumentDetails) warnings.push('Additional post details can increase collection time and cost; the per-source spend cap still applies.');
    }

    if (source.id === 'linkedin-profile') {
      sourceUrls = profileUrls(options.urls === undefined ? request.sourceUrls : options.urls, maxItems, options.urls === undefined ? 'sourceUrls' : `${field}.urls`);
      const startDate = dateOption(options, 'startDate', field);
      const postedLimit = enumOption(options, 'postedLimit', ['any', '1h', '24h', 'week', 'month', '3months', '6months', 'year'], 'any', field);
      if (startDate && postedLimit !== 'any') invalid(`${field}.startDate`, 'Choose a relative time window or a custom earliest date, not both.');
      const includeComments = booleanOption(options, 'includeComments', false, field);
      const includeReactions = booleanOption(options, 'includeReactions', false, field);
      // Zero means unlimited for this Actor, so never send it when a child collection is enabled.
      const maxComments = collectionCount(options, 'maxComments', includeComments, field);
      const maxReactions = collectionCount(options, 'maxReactions', includeReactions, field);
      const commentsPostedLimit = enumOption(options, 'commentsPostedLimit', ['any', '1h', '24h', 'week', 'month'], 'any', field);
      const includeQuotePosts = booleanOption(options, 'includeQuotePosts', true, field);
      const includeReposts = booleanOption(options, 'includeReposts', false, field);
      const contextCountry = enumOption(options, 'contextCountry', ['any', 'US', 'GB', 'DE', 'FR'], 'any', field);
      const maxPosts = Math.floor(maxItems / sourceUrls.length);
      actualItems = maxPosts * sourceUrls.length;
      maxResultItems = actualItems * (1 + (includeComments ? maxComments : 0) + (includeReactions ? maxReactions : 0));
      input = { targetUrls: sourceUrls, maxPosts, scrapeComments: includeComments, scrapeReactions: includeReactions, includeQuotePosts, includeReposts };
      if (options.postedLimit !== undefined) input.postedLimit = postedLimit;
      if (startDate) input.postedLimitDate = startDate;
      if (includeComments) Object.assign(input, { maxComments, commentsPostedLimit });
      if (includeReactions) input.maxReactions = maxReactions;
      if (options.contextCountry !== undefined) input.contextCountry = contextCountry;
      sourceOptions = { urls: sourceUrls, postedLimit, startDate, includeComments, maxComments, commentsPostedLimit, includeReactions, maxReactions, includeQuotePosts, includeReposts, contextCountry };
      targetSummary = `${sourceUrls.length} LinkedIn account${sourceUrls.length === 1 ? '' : 's'}`;
      dateSemantics = 'Collects recent account posts back to the earliest date, including that date. No custom end date; topic text is research context, not a keyword filter.';
      if (includeComments || includeReactions) warnings.push(`Comments and reactions are separate billable rows. Up to ${actualItems} posts and ${maxResultItems - actualItems} engagement rows are requested, subject to the spend cap.`);
      if (actualItems < maxItems) warnings.push(`The ${maxItems}-post allowance is split evenly: ${maxPosts} per account, ${actualItems} posts total.`);
    }

    return {
      name: `${source.name} · ${(query || targetSummary).slice(0, 100)}`,
      platform: source.platform,
      actorId: source.actorId,
      taskId: '',
      input,
      mapper: { ...source.mapper },
      proxyNote: source.scopeNote,
      runOptions: { maxTotalChargeUsd, timeoutSecs: 300 },
      searchContext: { sourceId: source.id, query, sourceUrls, maxItems: actualItems, requestedMaxItems: maxItems, maxResultItems, collectionMode: source.mode, schemaCheckedAt: source.schemaCheckedAt, sourceOptions, targetSummary, dateSemantics, warnings },
    };
  });
  return { recipes, totalMaxChargeUsd: Math.round(maxTotalChargeUsd * recipes.length * 100) / 100, totalRequestedItems: recipes.reduce((total, recipe) => total + recipe.searchContext.maxResultItems, 0), totalRequestedPosts: recipes.reduce((total, recipe) => total + recipe.searchContext.maxItems, 0), requestedSourceCount: recipes.length };
}

module.exports = { SOURCE_CATALOG, OPTION_KEYS, buildSearchRecipes };
