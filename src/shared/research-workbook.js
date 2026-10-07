// Lays a research run out as the Golden Thread workbook the team already reviews in Google Sheets:
// same tab names, same column headers, same order. Pure: no files, clocks, or provider calls.
const { PLATFORMS } = require('./research-program');

const SHEETS = {
  themes: { name: 'Theme Repository', columns: ['Theme', 'Theme Description', 'matching_keywords', 'matching_criteria', 'negative_criteria', 'Novelty', 'Status', 'Evidence Count', 'Taxonomy Category'] },
  x: { name: 'Twitter', columns: ['post_url', 'post_text', 'author', 'createdAt', 'retweetCount', 'replyCount', 'likeCount', 'quoteCount', 'viewCount', 'bookmarkCount', 'isReply', 'isRetweet', 'isQuote', 'Theme', 'Confidence_Score', 'Reasoning', 'prevalence_score', 'Entities_Tools', 'Entities_People', 'Entities_Companies', 'Pain_Point_Type', 'Urgency_Signal'] },
  reddit: { name: 'Reddit', columns: ['post_url', 'post_text', 'Subreddit', 'Username', 'Post Type', 'Post Title', 'Number of Comments', 'Upvotes', 'Upvote Ratio', 'Date Created', 'Theme', 'Confidence Score', 'Reasoning', 'prevalence_score', 'Entities_Tools', 'Entities_People', 'Entities_Companies', 'Pain_Point_Type', 'Urgency_Signal'] },
  linkedin: { name: 'LinkedIn', columns: ['post_url', 'Date', 'post_text', 'Total Reactions', 'Comments', 'Username', 'Headline', 'First Name', 'Last Name', 'Profile URL', 'Theme', 'Confidence Score', 'Reasoning', 'prevalence_score', 'Entities_Tools', 'Entities_People', 'Entities_Companies', 'Pain_Point_Type', 'Urgency_Signal'] },
  summary: { name: 'Theme Summary Data', columns: ['Theme', 'X Post Count', 'X Reposts', 'X Replies', 'X Likes', 'X Quotes', 'X Views', 'X Bookmarks', 'X Prevalence Score', 'LI Post Count', 'LI Reactions', 'LI Comment Count', 'LI Prevalence Score', 'Reddit Post Count', 'Reddit Comments', 'Reddit Upvotes', 'Reddit Prevalence Score', 'Overall Prevalence Score', 'Weighted Prevalence Score'] },
  counts: { name: 'Post Counts Reference', columns: ['Theme', 'X Post Count', 'LI Post Count', 'Reddit Post Count'] },
  velocity: { name: 'Trend Velocity', columns: ['Theme', 'Trend Report Link', 'Strategy Report Link', 'Visual Report Link', 'Date', 'Count', 'Velocity', 'Novelty', 'Theme Description', 'Priority Tier', 'Priority Score', 'Content Gap Signal', 'Taxonomy Category', 'Taxonomy Zone', 'Semrush Articles', 'Semrush Last 6Mo', 'Semrush Velocity', 'Editorial Action', 'Gap Rationale'] },
  taxonomy: { name: 'Taxonomy Lookup', columns: ['Category', 'Article Count', '% Share', 'Velocity', 'Last 6Mo', '6Mo Rate', 'Saturation', 'Zone', 'Top Keywords', 'Top Phrases', 'Timeline', 'Gap Analysis Notes', 'Editorial Action'] },
  batches: { name: 'Batch Analysis Log', columns: ['output', 'timestamp', 'batch_number', 'items_processed', 'batch_source', 'platform_breakdown', 'status'] },
};
const PLATFORM_LABEL = { x: 'Twitter', linkedin: 'LinkedIn', reddit: 'Reddit' };

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const at = (object, path) => path.split('.').reduce((value, key) => (isObject(value) ? value[key] : undefined), object);
const first = (object, paths) => { for (const path of paths) { const value = at(object, path); if (value !== undefined && value !== null && value !== '') return value; } return undefined; };
const cell = (value) => value === undefined || value === null ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : typeof value === 'number' ? (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '') : typeof value === 'object' ? JSON.stringify(value) : String(value);
const metric = (row, key) => (typeof row.metrics?.[key] === 'number' && Number.isFinite(row.metrics[key]) ? row.metrics[key] : null);
const stripQuery = (url) => { try { const parsed = new URL(String(url)); parsed.search = ''; parsed.hash = ''; return parsed.href.replace(/\/$/, ''); } catch (_) { return String(url || ''); } };
const round2 = (value) => Math.round(value * 100) / 100;

function themeLookup(source) {
  const map = new Map();
  for (const theme of [...(source.themes || []), ...(source.run?.discoveredThemes || []), ...(source.run?.themes || [])]) if (theme?.id) map.set(theme.id, { ...(map.get(theme.id) || {}), ...theme });
  return map;
}

// The theme column reads like the reviewed sheet: accepted tags as-is, low-confidence suggestions marked for review.
function tagColumns(assignment, themes) {
  if (!assignment) return { theme: '', confidence: '', reason: '', tools: '', people: '', companies: '', pain: '', urgency: '' };
  const accepted = assignment.status === 'accepted' && assignment.themeId;
  const suggested = assignment.status === 'needs-review' && (assignment.suggestedThemeId || assignment.themeId);
  const name = accepted ? themes.get(assignment.themeId)?.name : suggested ? `${themes.get(suggested)?.name || 'Unnamed theme'} (needs review)` : '';
  const list = (key) => (assignment.entities?.[key] || []).join(', ');
  return { theme: name || '', confidence: typeof assignment.confidence === 'number' ? cell(assignment.confidence) : '', reason: assignment.reason || '', tools: list('tools'), people: list('people'), companies: list('companies'), pain: assignment.painPoint && assignment.painPoint !== 'None' ? assignment.painPoint : '', urgency: assignment.urgency && assignment.urgency !== 'None' ? assignment.urgency : '' };
}

function platformRow(platform, row, raw = {}, tags) {
  const score = row.engagement?.value;
  if (platform === 'x') {
    return [row.url, first(raw, ['fullText', 'text']) ?? row.text, row.author, first(raw, ['createdAt']) ?? row.publishedAt,
      first(raw, ['retweetCount']) ?? metric(row, 'shares'), first(raw, ['replyCount']) ?? metric(row, 'comments'), first(raw, ['likeCount']) ?? metric(row, 'likes'), first(raw, ['quoteCount']) ?? metric(row, 'quotes'), first(raw, ['viewCount']) ?? metric(row, 'views'), first(raw, ['bookmarkCount']) ?? metric(row, 'bookmarks'),
      raw.isReply ?? (row.parentId ? true : ''), raw.isRetweet ?? '', raw.isQuote ?? '',
      tags.theme, tags.confidence, tags.reason, score, tags.tools, tags.people, tags.companies, tags.pain, tags.urgency].map(cell);
  }
  if (platform === 'reddit') {
    const community = first(raw, ['communityName', 'parsedCommunityName', 'subreddit']);
    const subreddit = community ? (String(community).startsWith('r/') ? community : `r/${community}`) : '';
    const title = first(raw, ['title']) || '';
    const body = first(raw, ['body', 'text']) ?? (title && row.text.startsWith(title) ? row.text.slice(title.length).trim() : row.text);
    return [row.url, body, subreddit, row.author, first(raw, ['dataType']) || row.type || 'post', title,
      first(raw, ['numberOfComments']) ?? metric(row, 'comments'), first(raw, ['upVotes']) ?? metric(row, 'upvotes'), first(raw, ['upVoteRatio']) ?? metric(row, 'upvoteRatio'), first(raw, ['createdAt']) ?? row.publishedAt,
      tags.theme, tags.confidence, tags.reason, score, tags.tools, tags.people, tags.companies, tags.pain, tags.urgency].map(cell);
  }
  const name = String(first(raw, ['author.name', 'authorName', 'authorFullName']) || row.author || '').trim();
  const [firstName = '', ...rest] = name.split(/\s+/);
  const profile = first(raw, ['author.linkedinUrl', 'authorProfileUrl', 'author.url', 'authorUrl']);
  return [row.url, first(raw, ['postedAt.date', 'postedAtISO']) ?? row.publishedAt, first(raw, ['content', 'text']) ?? row.text, metric(row, 'likes'), metric(row, 'comments'),
    first(raw, ['author.publicIdentifier', 'authorPublicIdentifier']) || row.author, first(raw, ['author.info', 'authorHeadline', 'author.headline', 'authorTitle']) || '', firstName, rest.join(' '), profile ? stripQuery(profile) : '',
    tags.theme, tags.confidence, tags.reason, score, tags.tools, tags.people, tags.companies, tags.pain, tags.urgency].map(cell);
}

function emptySheet(key, title, detail) { return { id: key, name: SHEETS[key].name, columns: SHEETS[key].columns, rows: [], rowKeys: [], empty: { title, detail } }; }

function themeTotals(source, themes) {
  const approved = (source.run?.themes || []).filter((theme) => theme?.id);
  const byId = new Map(approved.map((theme) => [theme.id, { theme, rows: [] }]));
  const evidence = new Map((source.evidence || []).map((row) => [row.id, row]));
  for (const assignment of source.assignments || []) {
    if (assignment.status === 'rejected' || !assignment.themeId || !byId.has(assignment.themeId)) continue;
    const row = evidence.get(assignment.itemId); if (row) byId.get(assignment.themeId).rows.push(row);
  }
  return [...byId.values()].map(({ theme, rows }) => {
    const per = Object.fromEntries(PLATFORMS.map((p) => [p, rows.filter((row) => row.platform === p)]));
    const sum = (p, key) => per[p].reduce((total, row) => total + (metric(row, key) || 0), 0);
    const prevalence = (p) => round2(per[p].reduce((total, row) => total + (typeof row.engagement?.value === 'number' ? row.engagement.value : 0), 0));
    return { theme: themes.get(theme.id) || theme, per, sum, prevalence, overall: round2(PLATFORMS.reduce((total, p) => total + prevalence(p), 0)) };
  });
}

function buildResearchWorkbook(source = {}) {
  const run = source.run || {}; const themes = themeLookup(source); const raw = source.raw || {};
  const assignments = new Map((source.assignments || []).map((row) => [row.itemId, row]));
  const evidence = source.evidence || []; const classified = assignments.size > 0;
  const sheets = [];

  // Theme Repository: every discovered theme, with the review decision beside it.
  const discovered = run.discoveredThemes || run.themes || [];
  const approvedIds = new Set((run.themes || []).map((theme) => theme.id));
  const status = (theme) => run.decisions?.[theme.id] === 'passed' ? 'Passed' : (run.decisions?.[theme.id] === 'approved' || (run.approvedAt && approvedIds.has(theme.id))) ? 'Approved' : run.status === 'awaiting-review' ? 'Waiting for review' : approvedIds.has(theme.id) ? 'Approved' : '';
  sheets.push(discovered.length ? {
    id: 'themes', name: SHEETS.themes.name, columns: SHEETS.themes.columns,
    rows: discovered.map((theme) => [theme.name, theme.description, JSON.stringify(theme.matchingKeywords || []), theme.matchingCriteria, theme.negativeCriteria, theme.novelty, status(theme), theme.evidenceCount ?? (theme.evidenceIds || []).length, theme.taxonomyCategory].map(cell)),
    rowKeys: discovered.map((theme) => theme.id),
  } : emptySheet('themes', 'No themes yet', run.stage === 'discovery' || run.stage === 'collecting' ? 'Themes appear here when discovery finishes reading the evidence.' : 'This run stopped before discovery found themes. Retry it from Research programs.'));

  // One tab per platform, newest first like the sheet.
  for (const platform of ['x', 'reddit', 'linkedin']) {
    const rows = evidence.filter((row) => row.platform === platform).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    if (!rows.length) { sheets.push(emptySheet(platform, `No ${PLATFORM_LABEL[platform]} posts in this run`, 'Nothing from this platform was kept. Check the source list and the collection receipt in Research programs.')); continue; }
    sheets.push({ id: platform, name: SHEETS[platform].name, columns: SHEETS[platform].columns, rows: rows.map((row) => platformRow(platform, row, raw[row.sourceItemId] || {}, tagColumns(assignments.get(row.id), themes))), rowKeys: rows.map((row) => row.id), frozenColumns: 1 });
  }

  const totals = classified ? themeTotals(source, themes) : [];
  const max = Math.max(0, ...totals.map((entry) => entry.overall));
  if (totals.length) {
    sheets.push({ id: 'summary', name: SHEETS.summary.name, columns: SHEETS.summary.columns,
      rows: totals.sort((a, b) => b.overall - a.overall).map(({ theme, per, sum, prevalence, overall }) => [theme.name,
        per.x.length, sum('x', 'shares'), sum('x', 'comments'), sum('x', 'likes'), sum('x', 'quotes'), sum('x', 'views'), sum('x', 'bookmarks'), prevalence('x'),
        per.linkedin.length, sum('linkedin', 'likes'), sum('linkedin', 'comments'), prevalence('linkedin'),
        per.reddit.length, sum('reddit', 'comments'), sum('reddit', 'upvotes'), prevalence('reddit'),
        overall, max ? round2(overall / max * 100) : 0].map(cell)),
      rowKeys: totals.map(({ theme }) => theme.id), frozenColumns: 1,
      note: 'Prevalence is the sum of each post’s prevalence_score. Weighted Prevalence Score scales the top theme to 100.' });
    sheets.push({ id: 'counts', name: SHEETS.counts.name, columns: SHEETS.counts.columns, rows: totals.map(({ theme, per }) => [theme.name, per.x.length, per.linkedin.length, per.reddit.length].map(cell)), rowKeys: totals.map(({ theme }) => theme.id) });
  } else {
    const detail = run.approvedAt ? 'Totals appear as soon as the first classification batch finishes.' : 'Approve themes on the Trend board, then continue the run to tag every post. Totals fill in from those tags.';
    sheets.push(emptySheet('summary', 'Theme totals appear after tagging', detail));
    sheets.push(emptySheet('counts', 'Post counts appear after tagging', detail));
  }

  // Trend Velocity: one row per theme per run it appeared in. Editorial columns are left for reviewers.
  const runDates = new Map((source.runs || []).map((row) => [row.id, row.createdAt]));
  const reports = new Map((source.reports || []).map((entry) => [entry.themeId, entry]));
  const history = (source.history || []).filter((snapshot) => snapshot.matchedCount > 0 || snapshot.runId === run.id);
  if (history.length) {
    const sorted = [...history].sort((a, b) => String(runDates.get(b.runId) || b.period?.endDate || '').localeCompare(String(runDates.get(a.runId) || a.period?.endDate || '')));
    sheets.push({ id: 'velocity', name: SHEETS.velocity.name, columns: SHEETS.velocity.columns,
      rows: sorted.map((snapshot) => {
        const theme = themes.get(snapshot.themeId) || {}; const report = snapshot.runId === run.id ? reports.get(snapshot.themeId) : null;
        const link = (id) => report?.assets?.find((asset) => asset.deliverableId === id)?.url || '';
        const growth = theme.history?.snapshot?.runId === snapshot.runId && theme.history?.growth?.comparable && typeof theme.history.growth.relativePercentChange === 'number' ? `${theme.history.growth.relativePercentChange > 0 ? '+' : ''}${theme.history.growth.relativePercentChange}%` : '';
        const date = runDates.get(snapshot.runId) || snapshot.period?.endDate || '';
        return [theme.name || snapshot.themeId, link('evidence-report'), link('editorial-toolkit'), '', date ? String(date).slice(0, 16).replace('T', ' ') : '', snapshot.matchedCount, growth, theme.novelty, theme.description, '', '', '', theme.taxonomyCategory, '', '', '', '', '', ''].map(cell);
      }),
      rowKeys: sorted.map((snapshot) => `${snapshot.runId}:${snapshot.themeId}`), frozenColumns: 1 });
  } else sheets.push(emptySheet('velocity', 'Velocity builds up across runs', 'Each finished run adds a row per theme with its post count. Run the program again later to compare periods.'));

  sheets.push(emptySheet('taxonomy', 'Taxonomy comes from your Google Sheet', 'The app doesn’t track Semrush blog coverage yet. Import your Golden Thread workbook to see its Taxonomy Lookup tab beside this research.'));

  // Batch Analysis Log: what discovery read in each batch and what it proposed.
  const batches = source.batches || [];
  if (batches.length) {
    const byId = new Map(evidence.map((row) => [row.id, row]));
    sheets.push({ id: 'batches', name: SHEETS.batches.name, columns: SHEETS.batches.columns,
      rows: batches.map((batch) => {
        const items = (batch.evidenceIds || []).map((id) => byId.get(id)).filter(Boolean);
        const breakdown = {}; for (const platform of PLATFORMS) { const rows = items.filter((row) => row.platform === platform); if (rows.length) breakdown[PLATFORM_LABEL[platform]] = platformBreakdown(platform, rows); }
        return [batch.candidates ? JSON.stringify({ candidates: batch.candidates.map(({ name, summary, painPoint, actionability, semanticIntentSignals, evidenceCount, platforms }) => ({ name, summary, painPoint, actionability, semanticIntentSignals, evidenceCount, platforms })) }, null, 2) : '',
          batch.completedAt, batch.index, items.length, Object.keys(breakdown).join(', '), JSON.stringify(breakdown), batch.candidates ? 'Analyzed' : 'Not analyzed yet'].map(cell);
      }),
      rowKeys: batches.map((batch) => batch.id) });
  } else sheets.push(emptySheet('batches', 'No discovery batches yet', 'Batches are planned once evidence is collected.'));

  return { id: run.id, name: run.title || 'Research run', kind: 'research', createdAt: run.createdAt || '', updatedAt: run.updatedAt || run.createdAt || '', status: run.status || '', stage: run.stage || '', sheets };
}

function platformBreakdown(platform, rows) {
  const total = (key) => rows.reduce((sum, row) => sum + (metric(row, key) || 0), 0);
  const scores = rows.map((row) => row.engagement?.value).filter((value) => typeof value === 'number');
  const avgPrevalence = scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  if (platform === 'x') return { total_posts: rows.length, total_likes: total('likes'), total_retweets: total('shares'), total_replies: total('comments'), total_quotes: total('quotes'), total_views: total('views'), total_bookmarks: total('bookmarks'), avg_prevalence: avgPrevalence };
  if (platform === 'linkedin') return { total_posts: rows.length, total_reactions: total('likes'), total_comments: total('comments'), total_shares: total('shares'), avg_prevalence: avgPrevalence };
  const ratios = rows.map((row) => metric(row, 'upvoteRatio')).filter((value) => value !== null);
  return { total_posts: rows.length, total_upvotes: total('upvotes'), total_comments: total('comments'), avg_upvote_ratio: ratios.length ? round2(ratios.reduce((a, b) => a + b, 0) / ratios.length) : 0, avg_prevalence: avgPrevalence };
}

module.exports = { RESEARCH_SHEETS: SHEETS, buildResearchWorkbook };
