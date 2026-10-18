'use strict';
// A channel owner's Ask AI, built only from what their channel view shows: roles.js projectState's channel share of the
// state (contentStudio.channelView from channel-view.js buildChannelView, and their own noteMentions). Pure CommonJS,
// Electron-free. index.js hands it the projected view and `readText(assetId)` for one file's text; readText is only
// ever called with a file this view lists (a ready trend's brief, or one of their channel's drafts). Nothing here can
// reach another channel's drafts or answers, research runs, programs, collected posts, prompts, settings, people,
// analytics or money, because none of it is given to it, and every result goes through roles.stripMoney as well.
//
// channelContext(...)   LIVE CONTEXT for help-assistant.js channelPromptParts
// channelLookup(...)    trend (its brief), asset-folder, asset, find, conversation, memory
// channelResolve(...)   each button's item by its target, and [[Trend]] links
// channelHydrate(...)   trend and asset-folder cards, action forms and choices
// channelGuide(guide)   the app guide's channel owner sections
// channelNames(view)    names a memory can mention (recall boosts them)
const { stripMoney } = require('./roles');
const helpAssistant = require('./help-assistant');
const { tokens, bm25 } = require('./ask-store');

const list = (value) => (Array.isArray(value) ? value : []);
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const day = (value) => String(value || '').slice(0, 10);
const time = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : NaN; };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const ACTIVE = new Set(['queued', 'running']);
const UNFINISHED = new Set(['failed', 'partial', 'cancelled']);
const PRIORITY = { top: 'Top priority', strong: 'Strong', watch: 'Worth watching' };
const ANSWER = { using: 'using it', 'not-using': 'not for us' };
const PAGES = { trends: 'Trends', assets: 'My assets', plan: 'My plan', inbox: 'Inbox' };
const TABS = ['trends', 'assets', 'plan', 'inbox', 'ask'];
const MAX_TEXT = 16000;
// "Blog — Short News Update" → "Short News Update": the channel is already named.
const fileLabel = (label) => String(label || '').replace(/^[^—]+—\s*/, '') || String(label || '');

// ---------- Reading the view ----------
function viewOf(view) {
  const value = view && typeof view === 'object' ? view : {};
  return { channel: value.channel && typeof value.channel === 'object' ? value.channel : {}, trends: list(value.trends), runs: list(value.runs), assets: list(value.assets) };
}
// Exact name first, then the closest name that contains the ref or sits inside it (refs under 4 characters match
// exactly only); every row that ties, so two equally good matches become a question, never a guess.
function matches(rows, nameOf, ref) {
  const wanted = norm(ref); if (!wanted) return [];
  const exact = rows.filter((row) => list([].concat(nameOf(row))).some((name) => norm(name) === wanted));
  if (exact.length) return exact;
  if (wanted.length < 4) return [];
  let best = []; let gap = Infinity;
  for (const row of rows) {
    const names = list([].concat(nameOf(row))).map(norm).filter((name) => name.length >= 4 && (name.includes(wanted) || wanted.includes(name)));
    if (!names.length) continue;
    const diff = Math.min(...names.map((name) => Math.abs(name.length - wanted.length)));
    if (diff < gap) { best = [row]; gap = diff; } else if (diff === gap) best.push(row);
  }
  return best;
}
const pick = (rows, nameOf, ref) => matches(rows, nameOf, ref)[0] || null;
// A trend's names: its own, and its brief's titles ("AI Citation Tracking — Comprehensive Trends Report").
const trendNames = (trend) => [trend.name, ...list(trend.reportAssets).map((asset) => asset.title)].filter(Boolean);
const briefOf = (trend) => list(trend.reportAssets).find((asset) => asset.id === trend.primaryReportId) || list(trend.reportAssets)[0] || null;
const answerOf = (trend) => (trend.adoption ? { answer: ANSWER[trend.adoption.status] || trend.adoption.status, ...(trend.adoption.plannedFor ? { plannedFor: trend.adoption.plannedFor } : {}), ...(trend.adoption.link ? { link: trend.adoption.link } : {}), ...(trend.adoption.byName ? { answeredBy: trend.adoption.byName } : {}) } : { answer: '' });
// This channel's sets, newest first, grouped by trend (themeId, else the set's title).
function setsByTrend(view) {
  const groups = new Map();
  for (const run of view.runs) {
    const key = run.kit?.themeId || `title:${norm(run.kit?.sourceTitle || run.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return groups;
}
const keyOf = (run) => run.kit?.themeId || `title:${norm(run.kit?.sourceTitle || run.title)}`;
const setTitle = (run) => run.kit?.sourceTitle || run.title || 'Untitled trend';
const filesOf = (view, run) => view.assets.filter((asset) => asset.runId === run.id);
const left = (run) => list(run.jobs).filter((job) => job.status !== 'succeeded').length;
function setView(view, run) {
  const files = filesOf(view, run);
  const done = Number(run.progress?.done) || list(run.jobs).filter((job) => job.status === 'succeeded').length;
  const total = Number(run.progress?.total) || list(run.jobs).length;
  return {
    trend: setTitle(run), status: run.status, ready: `${done} of ${total}`, made: day(run.createdAt), message: clip(run.message, 200),
    sharedWithOtherChannels: Boolean(run.shared), ...(run.needsAdmin ? { needsAdmin: true } : {}),
    ...(UNFINISHED.has(run.status) && left(run) ? { needsAnotherTry: list(run.jobs).filter((job) => job.status !== 'succeeded').map((job) => fileLabel(job.label)).slice(0, 12) } : {}),
    files: list(run.jobs).slice(0, 20).map((job) => { const asset = files.find((row) => row.id === job.assetId || list(job.assetIds).includes(row.id)); return { file: fileLabel(job.label), kind: job.kind || 'text', status: job.status === 'succeeded' ? asset?.status || 'draft' : job.status, ...(asset?.link ? { link: asset.link } : {}) }; }),
  };
}
// What this role may do, in words, from the methods it holds (viewer.allowed; in a preview, the previewed role's).
function canDoOf(allowed, imagesOn) {
  const may = (method) => allowed.has(method);
  return [
    'Read the briefs of the trends offered to their channel',
    may('planAssetKit') && may('createAssetKit') ? 'Generate drafts for their channel from a brief' : '',
    may('setTrendAdoption') ? 'Say whether their channel is using a trend, with its live link and planned date' : '',
    may('cancelStudioRun') ? 'Stop a set of drafts being made for their channel only' : '',
    may('retryStudioRun') ? 'Finish drafts that didn’t make it in a set made for their channel only' : '',
    may('saveAssetKitFolder') ? 'Save a set of drafts as a folder' : '',
    may('saveReportNote') ? 'Leave notes on their channel’s briefs and drafts' : '',
    imagesOn ? 'Make pictures here in Ask AI' : '',
  ].filter(Boolean);
}

// ---------- What needs them now ----------
// Up to 6 { what, why, kind, target }, most urgent first, by plain rules (no AI); kind and target are the button that
// would help (only kinds this role can use; the reply cleaner drops any other).
function channelAttention(view, { allowed = new Set(), noteMentions = [], now = Date.now() } = {}) {
  const v = viewOf(view); const out = [];
  const add = (what, why, kind, target = '') => out.push({ what: clip(what, 160), why: clip(why, 200), kind, target: clip(target, 160) });
  const fresh = v.trends.filter((trend) => trend.isNew && !trend.adoption);
  if (fresh.length) add(`${plural(fresh.length, 'new trend')} for ${v.channel.name || 'your channel'}`, `Newest: “${fresh[0].name}”.${allowed.has('setTrendAdoption') ? ' Say whether you’re using each one.' : ''}`, 'open-tab', 'trends');
  const seen = new Set();
  for (const run of v.runs) {
    const key = keyOf(run); if (seen.has(key)) continue; seen.add(key);
    if (run.needsAdmin) { add(`Drafts for “${setTitle(run)}” stopped`, 'Ask an admin: the AI connection needs attention.', 'open', setTitle(run)); continue; }
    if (UNFINISHED.has(run.status) && left(run) && !run.shared) add(`${plural(left(run), 'draft')} for “${setTitle(run)}” didn’t finish`, 'Finish the rest to make them.', allowed.has('retryStudioRun') ? 'finish-assets' : 'open', setTitle(run));
    else if (ACTIVE.has(run.status)) add(`Drafts for “${setTitle(run)}” are being made`, clip(run.message, 160), 'open', setTitle(run));
  }
  // A planned day coming up, for a role with My plan (Mark trends used): one without it can't open My plan or save a link.
  for (const trend of allowed.has('setTrendAdoption') ? v.trends.filter((row) => row.adoption?.status === 'using' && row.adoption.plannedFor) : []) {
    const days = (time(`${trend.adoption.plannedFor}T00:00:00Z`) - now) / 86400000;
    if (days >= -1 && days <= 7) add(`You planned “${trend.name}” for ${trend.adoption.plannedFor}`, trend.adoption.link ? 'It has its live link.' : 'Add the live link once it’s out.', 'mark-used', trend.name);
  }
  const unread = list(noteMentions).filter((row) => row && !row.read);
  if (unread.length) add(`${plural(unread.length, 'note')} for you`, `Newest from ${unread[0].by?.name || 'a teammate'} on “${clip(unread[0].assetTitle, 80)}”.`, 'open-tab', 'inbox');
  return out.slice(0, 6);
}

// ---------- LIVE CONTEXT ----------
// `viewer`: the asker as the server sees them (channelName, roleLabel, askAdmin, allowed or, in a preview, roleAllowed);
// `page`: where they asked from (askPage); `pictures`: { available, families: [{ family, set }] }.
function channelContext({ view, noteMentions = [], viewer = {}, page = {}, workspaceName = '', appVersion = '', edition = '', pictures = {}, now = Date.now() } = {}) {
  const v = viewOf(view);
  const allowed = new Set(list(viewer.preview ? viewer.roleAllowed || viewer.allowed : viewer.allowed));
  const groups = setsByTrend(v);
  const openTrend = page.trend ? pick(v.trends, trendNames, page.trend) : null;
  const trends = v.trends.slice(0, 30).map((trend) => {
    const sets = groups.get(trend.themeId) || [];
    const brief = briefOf(trend);
    return {
      name: clip(trend.name, 120), about: clip(trend.description, 240), ...(PRIORITY[trend.priority] ? { priority: PRIORITY[trend.priority] } : {}), ...(trend.category ? { category: clip(trend.category, 60) } : {}),
      ready: day(trend.readyAt), new: Boolean(trend.isNew), offeredToYourChannel: trend.offered !== false, ...(trend.forUs ? { sentToYourChannel: true } : {}), ...(trend.earlier ? { beforeYouJoined: true } : {}),
      ...(trend.decidedBy?.name && !trend.decidedBy.auto ? { approvedBy: clip(trend.decidedBy.name, 80) } : {}),
      ...(trend.suggestion ? { suggestion: { ...(trend.suggestion.byName ? { by: clip(trend.suggestion.byName, 80) } : {}), ...(trend.suggestion.note ? { note: clip(trend.suggestion.note, 280) } : {}), ...(list(trend.suggestion.channels).length ? { for: list(trend.suggestion.channels).map((row) => clip(row.name, 60)) } : {}) } } : {}),
      ...answerOf(trend),
      brief: brief ? clip(brief.title, 160) : '', ...(trend.briefEditedAt ? { briefEdited: day(trend.briefEditedAt) } : {}),
      drafts: sets.length ? { sets: sets.length, files: Number(trend.assetCount) || 0, latest: sets[0].status } : null,
    };
  });
  const drafts = v.runs.slice(0, 15).map((run) => setView(v, run));
  const plan = v.trends.filter((trend) => trend.adoption?.status === 'using').sort((a, b) => String(a.adoption.plannedFor || '9999').localeCompare(String(b.adoption.plannedFor || '9999'))).slice(0, 20).map((trend) => ({ trend: clip(trend.name, 120), plannedFor: trend.adoption.plannedFor || 'no date yet', ...(trend.adoption.link ? { link: trend.adoption.link } : {}) }));
  const inbox = list(noteMentions).filter(Boolean).slice(0, 10).map((row) => ({ kind: row.kind === 'reply' ? 'reply to your note' : 'mention', on: clip(row.assetTitle, 160), from: clip(row.by?.name, 80), excerpt: clip(row.excerpt, 200), at: day(row.at), ...(row.read ? {} : { unread: true }) }));
  const context = {
    appVersion: String(appVersion || ''), edition: String(edition || ''), role: 'channel owner', ...(viewer.roleLabel && viewer.roleLabel !== 'Channel owner' ? { roleName: clip(viewer.roleLabel, 40) } : {}), layout: 'channel',
    channel: { name: clip(v.channel.name || viewer.channelName || 'Your channel', 80), generateMakes: list(v.channel.deliverables).filter((item) => pictures.available || item.kind !== 'image').map((item) => fileLabel(item.label)).slice(0, 12) },
    askAdmin: clip(viewer.askAdmin || 'an admin', 120),
    workspace: { name: clip(workspaceName, 80) },
    currentPage: { tab: TABS.includes(page.tab) ? page.tab : 'ask', ...(openTrend ? { openTrend: clip(openTrend.name, 120) } : {}) },
    canDo: canDoOf(allowed, Boolean(pictures.available)),
    attention: channelAttention(v, { allowed, noteMentions, now }),
    counts: { trends: v.trends.length, new: v.trends.filter((trend) => trend.isNew).length, using: v.trends.filter((trend) => trend.adoption?.status === 'using').length, notForUs: v.trends.filter((trend) => trend.adoption?.status === 'not-using').length, sets: v.runs.length, files: v.assets.length },
    trends, drafts, plan, inbox,
    latestTrends: v.trends.slice(0, 6).map((trend) => ({ name: clip(trend.name, 120), summary: clip(trend.description, 300) })),
    pictures: { available: Boolean(pictures.available), brandReferenceImages: pictures.available ? list(pictures.families).slice(0, 6).map((row) => ({ family: String(row.family || ''), set: clip(row.set, 80) })) : [] },
  };
  return stripMoney(context);
}

// ---------- Names ----------
// Every named thing this person can be pointed at: their trends (a brief), the sets made for their channel (a folder,
// keyed by trend) and their pages.
function channelItems(view) {
  const v = viewOf(view);
  const items = v.trends.map((trend) => ({ kind: 'trend', id: trend.themeId, title: trend.name || '', aliases: list(trend.reportAssets).map((asset) => asset.title).filter(Boolean), where: 'Trends', date: day(trend.readyAt), trend }));
  const seen = new Set();
  for (const run of v.runs) { const key = keyOf(run); if (seen.has(key)) continue; seen.add(key); items.push({ kind: 'folder', id: run.kit?.themeId || run.id, title: setTitle(run), aliases: [], where: 'My assets', date: day(run.createdAt), run }); }
  for (const asset of v.assets) items.push({ kind: 'file', id: asset.id, title: asset.title || '', aliases: [], where: 'My assets', date: day(asset.createdAt), asset });
  for (const [id, title] of Object.entries(PAGES)) items.push({ kind: 'page', id, title, aliases: [id], where: 'Pages', date: '' });
  return items.filter((item) => item.title && item.id);
}
// Loose words → the best items, by BM25 over the names, with a nudge for recent ones.
function find(items, words, limit = 8) {
  const query = tokens(words); if (!query.length) return [];
  const scores = bm25(items.map((item) => tokens(`${item.title} ${item.aliases.join(' ')} ${item.where}`)), query);
  return items.map((item, index) => {
    let score = scores[index]; if (!score) return { item, score: 0 };
    const age = (Date.now() - time(item.date)) / 86400000; if (Number.isFinite(age)) score += 0.5 * Math.exp(-age / 30);
    if (norm(item.title).includes(norm(words)) && norm(words).length >= 4) score += 1;
    return { item, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
// Live names a memory can mention: their trends and draft titles.
function channelNames(view) {
  const v = viewOf(view);
  return [...v.trends.map((trend) => trend.name), ...v.assets.slice(0, 60).map((asset) => asset.title)].filter(Boolean);
}

// ---------- Lookups ----------
// One lookup for a channel owner. `readText(assetId)` → the file's markdown (index.js reads it through the content
// workspace); `conversations(query, limit)` and `memory(query)` search this person's own Ask AI space.
async function channelLookup({ kind, target } = {}, { view, readText = () => '', conversations = () => [], memory = () => [] } = {}) {
  const v = viewOf(view); const ref = clip(target, 200);
  const miss = { kind, target: ref, found: false };
  const text = async (assetId) => { let value = ''; try { value = String((await readText(assetId)) || ''); } catch (_) { value = ''; } return { text: value.slice(0, MAX_TEXT), ...(value.length > MAX_TEXT ? { shortenedFrom: value.length } : {}) }; };
  if (kind === 'trend' || kind === 'report') {
    const trend = pick(v.trends, trendNames, ref); if (!trend) return miss;
    const brief = briefOf(trend);
    return stripMoney({ kind, target: ref, found: true, title: trend.name, trend: { name: trend.name, about: clip(trend.description, 400), priority: PRIORITY[trend.priority] || '', category: trend.category || '', ready: day(trend.readyAt), ...answerOf(trend), ...(trend.suggestion?.note ? { suggestionNote: clip(trend.suggestion.note, 280) } : {}) }, ...(brief ? { brief: { title: brief.title || '', ...(await text(brief.id)) } } : { brief: null, note: 'Its brief isn’t ready yet.' }) });
  }
  const groups = setsByTrend(v);
  const setFor = (name) => { const trend = pick(v.trends, trendNames, name); const runs = trend ? groups.get(trend.themeId) : null; if (runs?.length) return runs[0]; return pick(v.runs, setTitle, name); };
  if (kind === 'asset-folder') {
    const run = setFor(ref); if (!run) return miss;
    return stripMoney({ kind, target: ref, found: true, title: setTitle(run), sets: (groups.get(keyOf(run)) || [run]).length, latest: setView(v, run) });
  }
  if (kind === 'asset') {
    const [folderName, fileName = ''] = String(ref).split(/\s*(?:›|>)\s*/);
    const run = setFor(folderName); if (!run) return miss;
    // Every set made for this trend, newest first: the newest one may have none of this channel's files yet.
    const runs = groups.get(keyOf(run)) || [run];
    const files = runs.flatMap((set) => filesOf(v, set).map((asset) => ({ asset, label: fileLabel(list(set.jobs).find((job) => job.id === asset.deliverableId)?.label || asset.title) })));
    const file = fileName ? pick(files, (row) => [row.label, row.asset.title], fileName) : null;
    if (!file) return stripMoney({ kind, target: ref, found: files.length > 0, title: setTitle(run), files: files.slice(0, 40).map((row) => ({ file: `${setTitle(run)} › ${row.label}`, status: row.asset.status, made: day(row.asset.createdAt) })) });
    return stripMoney({ kind, target: ref, found: true, title: `${setTitle(run)} › ${file.label}`, status: file.asset.status, ...(file.asset.link ? { link: file.asset.link } : {}), ...(file.asset.kind === 'text' ? await text(file.asset.id) : { picture: true }) });
  }
  if (kind === 'find') {
    const rows = find(channelItems(v), ref, 8).map(({ item }) => ({ type: item.kind === 'folder' ? 'drafts' : item.kind, title: item.title, where: item.where, ...(item.date ? { date: item.date } : {}) }));
    let earlier = []; try { earlier = list(await conversations(ref, 3)); } catch (_) { earlier = []; }
    const all = [...rows, ...earlier.map((row) => ({ type: 'conversation', title: row.title, where: 'Ask AI', date: day(row.updatedAt) }))].slice(0, 10);
    return { kind, target: ref, found: all.length > 0, title: ref, matches: all };
  }
  if (kind === 'conversation') {
    let rows = []; try { rows = list(await conversations(ref, 5)); } catch (_) { rows = []; }
    return { kind, target: ref, found: rows.length > 0, title: ref, conversations: rows };
  }
  if (kind === 'memory') {
    let rows = []; try { rows = list(await memory(ref)); } catch (_) { rows = []; }
    return { kind, target: ref, found: rows.length > 0, title: ref, items: rows.map((item) => ({ kind: item.kind, text: item.text, scope: item.scope, updatedAt: item.updatedAt })) };
  }
  return miss;
}

// ---------- Buttons and links ----------
// Each button's item, found in the view by its target, so it acts on exactly what it names; two equally good matches
// give `candidates` (the person picks on a choice card); a target that matches nothing drops the button and is said in
// `unresolved`. mark-used is always for their own channel. Returns { actions: [action | null], answer, unresolved }.
function channelResolve({ actions = [], answer = '' } = {}, { view, channelId = '' } = {}) {
  const v = viewOf(view); const groups = setsByTrend(v); const unresolved = [];
  const items = channelItems(v);
  const settle = (action, hits, idsOf, titleOf, detailOf = () => '') => {
    if (hits.length === 1) return { ...action, ...idsOf(hits[0]), title: titleOf(hits[0]) };
    if (hits.length > 1) return { ...action, candidates: hits.slice(0, 5).map((row) => ({ ids: idsOf(row), title: clip(titleOf(row), 160), detail: clip(detailOf(row), 160) })) };
    unresolved.push(action.target || action.label); return null;
  };
  const trendHits = (target, keep = () => true) => matches(v.trends.filter(keep), trendNames, target);
  const latestSet = (trend, keep) => (groups.get(trend.themeId) || []).find(keep) || null;
  const trendDetail = (trend) => `ready ${day(trend.readyAt)}`;
  const out = actions.map((action) => {
    if (!action || !helpAssistant.CATALOG[action.kind]) return null;
    const params = action.params || {};
    switch (action.kind) {
      case 'make-assets': return settle(action, trendHits(action.target, (trend) => Boolean(trend.primaryReportId)), (trend) => ({ themeId: trend.themeId, assetId: trend.primaryReportId }), (trend) => trend.name, trendDetail);
      // Always their own channel: a channel the model named is replaced, and the cleaner's note about it goes too.
      case 'mark-used': {
        const problems = list(action.problems).filter((line) => !/channels\.$/.test(line));
        const { problems: _problems, ...rest } = action;
        return settle({ ...rest, params: { ...params, channel: channelId }, ...(problems.length ? { problems } : {}) }, trendHits(action.target), (trend) => ({ themeId: trend.themeId }), (trend) => trend.name, trendDetail);
      }
      case 'finish-assets': case 'stop-run': case 'save-folder': {
        const keep = action.kind === 'finish-assets' ? (run) => UNFINISHED.has(run.status) && left(run) > 0 && !run.shared : action.kind === 'stop-run' ? (run) => ACTIVE.has(run.status) && !run.shared : (run) => filesOf(v, run).length > 0;
        const trends = trendHits(action.target).filter((trend) => latestSet(trend, keep));
        if (trends.length) return settle(action, trends, (trend) => ({ themeId: trend.themeId, runId: latestSet(trend, keep).id }), (trend) => trend.name, trendDetail);
        const runs = matches(v.runs.filter(keep), setTitle, action.target);
        return settle(action, runs.slice(0, 1), (run) => ({ themeId: run.kit?.themeId || '', runId: run.id }), setTitle);
      }
      case 'open': {
        const type = params.type || '';
        const page = Object.keys(PAGES).find((id) => id === norm(action.target) || norm(PAGES[id]) === norm(action.target));
        if (page && (type === 'page' || !trendHits(action.target).length)) return { ...action, page, ref: { kind: 'page', id: page }, title: PAGES[page] };
        if (type === 'page') { unresolved.push(action.target); return null; }
        if (type === 'folder') {
          const trends = trendHits(action.target).filter((trend) => (groups.get(trend.themeId) || []).length);
          return settle(action, trends, (trend) => ({ themeId: trend.themeId, ref: { kind: 'folder', id: trend.themeId } }), (trend) => trend.name, trendDetail);
        }
        let hits = trendHits(action.target);
        if (!hits.length) { const loose = find(items.filter((item) => item.kind === 'trend'), action.target, 4); hits = loose.length && (loose.length === 1 || loose[0].score >= loose[1].score * 1.5) ? [loose[0].item.trend] : loose.map((row) => row.item.trend); }
        return settle(action, hits, (trend) => ({ themeId: trend.themeId, ref: { kind: 'trend', id: trend.themeId } }), (trend) => trend.name, trendDetail);
      }
      case 'open-tab': { const tab = norm(action.target); if (TABS.includes(tab)) return { ...action, target: tab }; unresolved.push(action.target); return null; }
      case 'ask': return action;
      default: unresolved.push(action.target || action.label); return null;
    }
  });
  // [[Trend name]] becomes a studio:trend link to its brief; nothing else is linked.
  const trendIds = new Set(v.trends.map((trend) => trend.themeId));
  const linked = helpAssistant.linkAnswer(answer, {
    find: (title) => { const hits = matches(v.trends, trendNames, title); return hits.length === 1 ? { kind: 'trend', id: hits[0].themeId } : null; },
    known: (kind, id) => kind === 'trend' && trendIds.has(id),
  });
  return { actions: out, answer: linked, unresolved };
}

// ---------- Cards ----------
const FIELD_LABELS = { channel: 'Channel', status: 'Answer', link: 'Live link', date: 'Planned date', note: 'Note' };
const OPTION_LABELS = { using: 'Using it', 'not-using': 'Not for us', clear: 'Clear the answer' };
// When a button's inputs need the person's eye first (ask-actions.json form): mark-used always does.
function needsForm(action) {
  const spec = helpAssistant.CATALOG[action.kind]; const params = action.params || {};
  if (!spec || spec.form === 'never') return false;
  if (spec.form === 'always') return true;
  return Object.keys(params).some((key) => !['run', 'type', 'what', 'channel'].includes(key)) || Boolean(action.problems?.length);
}
// The action form for a channel owner: their channel is the only choice, already picked.
function actionCard(action, index, channel) {
  const spec = helpAssistant.CATALOG[action.kind]; const params = action.params || {};
  const fields = Object.entries(spec.params || {}).filter(([key]) => FIELD_LABELS[key]).map(([key, type]) => {
    const [kind, ...rest] = String(type).split(':');
    const options = kind === 'channel' ? [{ value: channel.id || '', label: channel.name || 'Your channel' }] : kind === 'enum' ? rest.join(':').split('|').map((value) => ({ value, label: OPTION_LABELS[value] || value })) : [];
    const value = key === 'channel' ? channel.id || '' : params[key] ?? (kind === 'enum' && action.kind === 'mark-used' && key === 'status' ? 'using' : '');
    return { key, type: kind, label: FIELD_LABELS[key], value, options, ...(kind === 'text' ? { max: Number(rest[0]) || 280 } : {}) };
  });
  return { type: 'action', title: action.label, note: '', actionIndexes: [index], data: { kind: action.kind, title: action.title || action.target || '', fields, problems: action.problems || [], spends: Boolean(spec.spends), confirm: spec.confirm } };
}
const choiceCard = (action, index) => ({ type: 'choice', title: `Which “${clip(action.target || action.label, 80)}” did you mean?`, note: '', actionIndexes: [index], data: { pick: true, options: action.candidates.map((row) => ({ label: row.title, detail: row.detail || '', ids: row.ids })) } });
// Cards under an answer, filled from the view (the renderer contract: { type, title, note, data, actionIndexes }); the
// model only names what a card is about. Model-only cards pass through helpAssistant.modelCard.
function channelHydrate({ cards = [], actions = [] } = {}, { view } = {}) {
  const v = viewOf(view); const groups = setsByTrend(v);
  const base = (card, title) => ({ type: card.type, title: card.title || clip(title, 120), note: card.note || '', actionIndexes: Array.isArray(card.actionIndexes) ? card.actionIndexes : [] });
  const pointed = (card) => (card.actionIndexes || []).map((at) => actions[at]).find((row) => row && row.themeId);
  const builders = {
    trend(card) {
      const button = pointed(card);
      const trend = (button && v.trends.find((row) => row.themeId === button.themeId)) || pick(v.trends, trendNames, card.ref);
      if (!trend) return null;
      const answer = trend.adoption ? [ANSWER[trend.adoption.status] ? `${ANSWER[trend.adoption.status][0].toUpperCase()}${ANSWER[trend.adoption.status].slice(1)}` : '', trend.adoption.plannedFor ? `planned ${trend.adoption.plannedFor}` : ''].filter(Boolean).join(' · ') : '';
      return { ...base(card, trend.name), data: { themeId: trend.themeId, runId: '', name: trend.name, category: trend.category || '', momentum: '', priorityTier: PRIORITY[trend.priority] || '', stage: '', evidenceCount: Number(trend.evidenceCount) || 0, platforms: [], runsSeen: 0, firstSeen: '', lastSeen: '', spark: [], reportAssetId: trend.primaryReportId || '', summary: clip(trend.description, 300), ...(answer ? { answer } : {}) } };
    },
    'asset-folder'(card) {
      const button = pointed(card);
      const trend = (button && v.trends.find((row) => row.themeId === button.themeId)) || pick(v.trends, trendNames, card.ref);
      const run = (trend && (groups.get(trend.themeId) || [])[0]) || pick(v.runs, setTitle, card.ref);
      if (!run) return null;
      const done = Number(run.progress?.done) || 0; const total = Number(run.progress?.total) || list(run.jobs).length;
      return { ...base(card, setTitle(run)), data: { sourceKey: run.kit?.themeId || '', title: setTitle(run), status: run.status, ready: done, total, latestRunId: run.id, channels: [{ name: v.channel.name || 'Your channel', count: filesOf(v, run).length }] } };
    },
  };
  const out = [];
  for (const card of list(cards)) {
    let built = null;
    try { built = builders[card?.type] ? builders[card.type](card) : helpAssistant.modelCard(card, actions); } catch (_) { built = null; }
    if (built) out.push(built);
  }
  // A trend card's ids go onto the buttons it points at that lack them (never onto one with candidates).
  for (const card of out.filter((row) => row.type === 'trend' || row.type === 'asset-folder')) {
    for (const at of card.actionIndexes) {
      const action = actions[at];
      if (!action || action.candidates || action.themeId) continue;
      if (card.type === 'trend' && ['make-assets', 'mark-used', 'open'].includes(action.kind)) { action.themeId = card.data.themeId; if (action.kind === 'make-assets' && card.data.reportAssetId) action.assetId = card.data.reportAssetId; }
    }
  }
  const inPlan = new Set(out.filter((card) => card.type === 'plan').flatMap((card) => card.actionIndexes));
  actions.forEach((action, index) => {
    if (!action) return;
    const has = (type) => out.some((card) => card.type === type && card.actionIndexes.includes(index));
    let built = null;
    if (action.candidates?.length) built = has('choice') ? null : choiceCard(action, index);
    else if (!inPlan.has(index) && needsForm(action) && !has('action')) built = actionCard(action, index, v.channel);
    if (!built) return;
    for (const card of out) if (card.type !== 'plan') card.actionIndexes = card.actionIndexes.filter((at) => at !== index);
    out.push(built);
  });
  return stripMoney(out.slice(0, 6));
}

// ---------- The guide ----------
// The app guide's sections for channel owners: "## For channel owners" whole, plus Inbox and "Calendar and My plan".
// Missing headings are skipped; with none found, the guide reads as missing.
const GUIDE_SECTIONS = [/^## For channel owners\s*$/m, /^### Inbox\s*$/m, /^### Calendar and My plan\s*$/m];
function channelGuide(guide) {
  const text = String(guide || ''); const parts = [];
  for (const heading of GUIDE_SECTIONS) {
    const match = heading.exec(text); if (!match) continue;
    const level = match[0].indexOf(' ');
    const rest = text.slice(match.index + match[0].length);
    const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
    parts.push(`${match[0].trim()}${next >= 0 ? rest.slice(0, next) : rest}`.trim());
  }
  return parts.join('\n\n');
}

module.exports = { channelContext, channelAttention, channelLookup, channelResolve, channelHydrate, channelGuide, channelNames, channelItems };
