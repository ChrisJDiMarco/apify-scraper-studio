import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Database, FileText, Globe2, LoaderCircle, MessageCircle, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import SOURCE_CATALOG from '../../shared/source-catalog-data.json';
import './search-view.css';

const DRAFT_KEY = 'apify-studio.search-draft.v2';
const TABS = ['Search brief', 'Sources & filters', 'Review & run'];
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const actorFullName = (actor) => actor.fullName || (actor.username && actor.name ? `${actor.username}/${actor.name}` : actor.name || '');
const entries = (value) => [...new Set(String(value || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
const DEFAULT_OPTIONS = {
  reddit: { subreddits: '', time: 'all', startDate: '', sort: 'relevance', searchComments: false, includeComments: false, maxComments: 5, commentStartDate: '', includeMediaLinks: true, includeNSFW: false },
  x: { handles: '', startDate: '', endDate: '', sort: 'Latest', replies: 'all', media: 'all', includeRetweets: true, conversationUrls: '' },
  'linkedin-search': { startDate: '', includeComments: false, maxComments: 5, includeReactions: false, maxReactions: 5, fetchDocumentDetails: false },
  'linkedin-profile': { urls: '', postedLimit: 'any', startDate: '', includeComments: false, maxComments: 5, commentsPostedLimit: 'any', includeReactions: false, maxReactions: 5, includeQuotePosts: true, includeReposts: false, contextCountry: 'any' },
};
const defaultDraft = () => ({ query: '', platformIds: ['reddit', 'x', 'linkedin-search'], maxItems: '10', budget: '0.25', sourceOptions: structuredClone(DEFAULT_OPTIONS) });
function readDraft() {
  const draft = defaultDraft();
  try {
    const stored = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
    if (!stored || typeof stored !== 'object') return draft;
    if (typeof stored.query === 'string') draft.query = stored.query.slice(0, 500);
    if (Array.isArray(stored.platformIds)) draft.platformIds = SOURCE_CATALOG.filter((source) => stored.platformIds.includes(source.id)).map((source) => source.id);
    for (const key of ['maxItems', 'budget']) if (typeof stored[key] === 'string' && stored[key].length <= 8) draft[key] = stored[key];
    for (const [id, options] of Object.entries(DEFAULT_OPTIONS)) for (const [key, fallback] of Object.entries(options)) {
      const value = stored.sourceOptions?.[id]?.[key];
      if (typeof fallback === 'boolean' && typeof value === 'boolean') draft.sourceOptions[id][key] = value;
      if (typeof fallback === 'number' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100) draft.sourceOptions[id][key] = Number(value);
      if (typeof fallback === 'string' && typeof value === 'string') draft.sourceOptions[id][key] = value.slice(0, ['subreddits', 'handles', 'urls', 'conversationUrls'].includes(key) ? 6000 : 32);
    }
  } catch { /* A missing or unavailable local store must not prevent searching. */ }
  return draft;
}

function SourceIcon({ source }) {
  return <span className={`search-platform-icon ${source.platform}`}>{source.platform === 'reddit' ? <MessageCircle size={20} aria-hidden="true" /> : <span aria-hidden="true">{source.platform === 'x' ? '𝕏' : 'in'}</span>}</span>;
}
function SelectField({ id, label, value, onChange, options, hint }) {
  return <div className="search-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select>{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
function DateField({ id, label, value, onChange, hint, min }) {
  return <div className="search-field"><label htmlFor={id}>{label}</label><input id={id} type="date" value={value} min={min} onChange={(event) => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
function CheckField({ id, label, checked, onChange, hint }) {
  return <label className="search-check-field" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span></label>;
}
function CountField({ id, label, value, onChange, hint }) {
  return <div className="search-field search-count-field"><label htmlFor={id}>{label}</label><input id={id} type="number" min="1" max="100" step="1" value={value} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</div>;
}
const WINDOWS = [['any', 'Any time'], ['1h', 'Past hour'], ['24h', 'Past 24 hours'], ['week', 'Past week'], ['month', 'Past month'], ['3months', 'Past 3 months'], ['6months', 'Past 6 months'], ['year', 'Past year']];
const REDDIT_WINDOWS = [['all', 'Any time'], ['hour', 'Past hour'], ['day', 'Past 24 hours'], ['week', 'Past week'], ['month', 'Past month'], ['year', 'Past year']];

function SourceFilters({ source, options, setOption, query }) {
  const id = source.id;
  const update = (key) => (value) => setOption(id, key, value);
  const target = (key, label, placeholder, hint) => <div className="search-field search-target-field"><label htmlFor={`search-${id}-${key}`}>{label}</label><textarea id={`search-${id}-${key}`} value={options[key]} onChange={(event) => update(key)(event.target.value)} rows={3} maxLength={6000} placeholder={placeholder} aria-describedby={`search-${id}-${key}-hint`} /><small id={`search-${id}-${key}-hint`}>{hint}</small></div>;
  const comments = <div className="search-option-block"><CheckField id={`search-${id}-includeComments`} label="Include thread comments" checked={options.includeComments} onChange={update('includeComments')} hint="Collect the discussion attached to each post." />{options.includeComments && <CountField id={`search-${id}-maxComments`} label="Comments per post" value={options.maxComments} onChange={update('maxComments')} hint={id === 'reddit' ? '1–100 per post. Posts and comments share the total Reddit result limit.' : '1–100 per post. Comments can add collection time and cost.'} />}</div>;
  const reactions = <div className="search-option-block"><CheckField id={`search-${id}-includeReactions`} label={id === 'linkedin-search' ? 'Include liked-user details' : 'Include reactions'} checked={options.includeReactions} onChange={update('includeReactions')} hint={id === 'linkedin-search' ? 'Collect available details about people who liked the posts.' : 'Collect available reaction records with the posts.'} />{options.includeReactions && <CountField id={`search-${id}-maxReactions`} label={id === 'linkedin-search' ? 'Liked users per post' : 'Reactions per post'} value={options.maxReactions} onChange={update('maxReactions')} hint={id === 'linkedin-search' ? '1–100. Extra details can add collection time and cost.' : '1–100. A separate limit; reactions can add cost and rows.'} />}</div>;
  return <div className="search-source-editor">
    <div className="search-editor-heading"><SourceIcon source={source} /><div><h3>{source.name}</h3><p>{id === 'linkedin-profile' ? 'Follow specific people and companies.' : id === 'reddit' ? 'Listen to the communities that matter to you.' : id === 'x' ? 'Search a topic, follow accounts, or explore a conversation.' : 'Search public posts by topic or keyword.'}</p></div></div>
    {id === 'reddit' && <>
      {target('subreddits', 'Subreddits', 'r/marketing\nr/SaaS\nr/analytics', 'One per line or separated by commas. Leave blank to search across Reddit. Names and Reddit community URLs work.')}
      <div className="search-fields-two"><SelectField id="search-reddit-time" label="Reddit time window" value={options.time} onChange={update('time')} options={REDDIT_WINDOWS} /><DateField id="search-reddit-startDate" label="Reddit posts after" value={options.startDate} onChange={update('startDate')} hint="Optional cutoff. An exact date uses newest-first order; Reddit has no end-date filter." /></div>
      <div className="search-collection-heading"><h4>What to collect</h4><span>Posts are included</span></div>{comments}
      <details className="search-advanced"><summary><SlidersHorizontal size={14} aria-hidden="true" />More Reddit options</summary><div className="search-advanced-body">
        <SelectField id="search-reddit-sort" label="Reddit sort order" value={options.sort} onChange={update('sort')} options={[["relevance", "Most relevant"], ["new", "Newest"], ["top", "Top"], ["hot", "Hot"], ["rising", "Rising"], ["comments", "Most comments"]]} hint={options.startDate ? 'Your exact date cutoff takes priority and uses newest-first order.' : undefined} />
        <CheckField id="search-reddit-searchComments" label="Search matching comments" checked={options.searchComments} onChange={update('searchComments')} hint="Find comments that match your topic in addition to posts." />
        {options.searchComments && !options.includeComments && <CountField id="search-reddit-maxComments" label="Comments per page" value={options.maxComments} onChange={update('maxComments')} hint="1–100 per comments page; posts and matching comments share the total Reddit result limit." />}
        {options.includeComments && <DateField id="search-reddit-commentStartDate" label="Reddit comments after" value={options.commentStartDate} onChange={update('commentStartDate')} />}
        <CheckField id="search-reddit-includeMediaLinks" label="Include media links" checked={options.includeMediaLinks} onChange={update('includeMediaLinks')} />
        <CheckField id="search-reddit-includeNSFW" label="Include NSFW results" checked={options.includeNSFW} onChange={update('includeNSFW')} />
      </div></details>
    </>}
    {id === 'x' && <>
      {target('handles', 'X accounts', '@OpenAI\n@AnthropicAI', 'One handle or profile URL per line. Leave blank to search all public accounts. Your topic filters these accounts when provided.')}
      <div className="search-fields-two"><DateField id="search-x-startDate" label="X start date" value={options.startDate} onChange={update('startDate')} hint="Optional. Includes this date (UTC)." /><DateField id="search-x-endDate" label="X end date" value={options.endDate} onChange={update('endDate')} min={options.startDate || undefined} hint="Optional. Includes this date (UTC)." /></div>
      <div className="search-fields-two"><SelectField id="search-x-sort" label="X sort order" value={options.sort} onChange={update('sort')} options={[["Latest", "Latest"], ["Top", "Top"], ["Latest + Top", "Latest and top"]]} /><SelectField id="search-x-replies" label="Replies" value={options.replies} onChange={update('replies')} options={[["all", "Posts and replies"], ["exclude", "Exclude replies"], ["only", "Replies only"]]} hint="X replies are search results; full comment threads are not automatically expanded." /></div>
      <details className="search-advanced"><summary><SlidersHorizontal size={14} aria-hidden="true" />More X options</summary><div className="search-advanced-body">
        <SelectField id="search-x-media" label="Media filter" value={options.media} onChange={update('media')} options={[["all", "Any content"], ["media", "Any media"], ["images", "Images"], ["videos", "Videos"], ["links", "Links"]]} />
        <CheckField id="search-x-includeRetweets" label="Include reposts" checked={options.includeRetweets} onChange={update('includeRetweets')} />
        {target('conversationUrls', 'X conversation URLs', 'https://x.com/account/status/123456789', 'Optional post URLs for conversation searches. Other selected search filters still apply.')}
      </div></details>
    </>}
    {id === 'linkedin-search' && <>
      <div className="search-context-note"><strong>Searching for {query.trim() ? `“${query.trim()}”` : 'your topic'}</strong><p>To follow specific people or companies, use the LinkedIn accounts source.</p></div>
      <DateField id="search-linkedin-search-startDate" label="LinkedIn search posts after" value={options.startDate} onChange={update('startDate')} hint="Optional earliest date. This Actor does not offer an end-date filter." />
      <div className="search-collection-heading"><h4>What to collect</h4><span>Posts are included</span></div>{comments}
      <details className="search-advanced"><summary><SlidersHorizontal size={14} aria-hidden="true" />More LinkedIn search options</summary><div className="search-advanced-body">{reactions}<CheckField id="search-linkedin-search-fetchDocumentDetails" label="Include document details" checked={options.fetchDocumentDetails} onChange={update('fetchDocumentDetails')} hint="Collect additional details for document posts where available." /></div></details>
    </>}
    {id === 'linkedin-profile' && <>
      {target('urls', 'LinkedIn profile or company URLs', 'https://www.linkedin.com/in/profile-name\nhttps://www.linkedin.com/company/company-name', 'One URL per line. The post allowance is divided across these targets.')}
      <div className="search-context-note"><strong>Collect their posts</strong><p>Your topic does not filter them. It becomes context for your research and analysis.</p></div>
      <div className="search-fields-two"><SelectField id="search-linkedin-profile-postedLimit" label="LinkedIn profile time window" value={options.postedLimit} onChange={update('postedLimit')} options={WINDOWS} hint="Choosing a relative window clears the custom date." /><DateField id="search-linkedin-profile-startDate" label="LinkedIn profile earliest date" value={options.startDate} onChange={update('startDate')} hint="Includes this date. Choosing a date clears the relative window; no end-date filter." /></div>
      <div className="search-collection-heading"><h4>What to collect</h4><span>Posts are included</span></div>{comments}
      <details className="search-advanced"><summary><SlidersHorizontal size={14} aria-hidden="true" />More LinkedIn profile options</summary><div className="search-advanced-body">
        {options.includeComments && <SelectField id="search-linkedin-profile-commentsPostedLimit" label="Comment time window" value={options.commentsPostedLimit} onChange={update('commentsPostedLimit')} options={WINDOWS.slice(0, 5)} />}
        {reactions}
        <CheckField id="search-linkedin-profile-includeQuotePosts" label="Include quote posts" checked={options.includeQuotePosts} onChange={update('includeQuotePosts')} />
        <CheckField id="search-linkedin-profile-includeReposts" label="Include reposts" checked={options.includeReposts} onChange={update('includeReposts')} />
        <SelectField id="search-linkedin-profile-contextCountry" label="Collection country" value={options.contextCountry} onChange={update('contextCountry')} options={[["any", "Automatic"], ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"]]} hint="Sets collection context. It does not filter people by country." />
      </div></details>
    </>}
    <div className="search-actor-footnote"><span>Powered by {source.actorId}</span><a href={source.schemaUrl} target="_blank" rel="noreferrer">Actor options ↗</a></div>
  </div>;
}

function sourceSummary(source, options, maxItems) {
  const id = source.id;
  const targets = entries(options.subreddits || options.handles || options.urls || options.conversationUrls);
  const conversationCount = entries(options.conversationUrls).length;
  const targetLabel = id === 'reddit' ? (targets.length ? targets.map((value) => /^https?:\/\//i.test(value) || /^r\//i.test(value) ? value : `r/${value}`).join(', ') : 'Across Reddit') : id === 'x' ? ([entries(options.handles).map((value) => /^https?:\/\//i.test(value) || value.startsWith('@') ? value : `@${value}`).join(', '), conversationCount ? `${conversationCount} conversation ${conversationCount === 1 ? 'thread' : 'threads'}` : ''].filter(Boolean).join(' · ') || 'All public accounts') : id === 'linkedin-profile' ? (targets.length ? targets.join(', ') : 'No profiles added yet') : 'LinkedIn keyword search';
  let timeframe = 'Any time';
  if (id === 'reddit') timeframe = [REDDIT_WINDOWS.find(([key]) => key === options.time)?.[1], options.startDate && `after ${options.startDate} · newest first`].filter(Boolean).join(' · ');
  if (id === 'x') timeframe = options.startDate || options.endDate ? `${options.startDate || 'Any start'} → ${options.endDate || 'Present'} (inclusive UTC dates)` : 'Any time';
  if (id === 'linkedin-search') timeframe = options.startDate ? `After ${options.startDate}` : 'Any time';
  if (id === 'linkedin-profile') timeframe = [WINDOWS.find(([key]) => key === options.postedLimit)?.[1], options.startDate && `from ${options.startDate}`].filter(Boolean).join(' · ');
  const additions = [options.includeComments && `up to ${options.maxComments} comments/post`, options.includeReactions && `up to ${options.maxReactions} ${id === 'linkedin-search' ? 'liked users' : 'reactions'}/post`, options.searchComments && `matching comments (up to ${options.maxComments}/page)`, options.fetchDocumentDetails && 'document details'];
  if (id === 'x') additions.push(options.replies === 'only' ? 'replies only' : options.replies === 'exclude' ? 'no replies' : 'posts and replies', options.sort, options.media !== 'all' && options.media, !options.includeRetweets && 'no reposts');
  if (id === 'linkedin-profile') additions.push(options.includeReposts && 'reposts', options.includeQuotePosts && 'quote posts');
  const actualPosts = id === 'linkedin-profile' && targets.length ? Math.floor(Number(maxItems) / targets.length) * targets.length : Number(maxItems);
  const maxRows = id === 'linkedin-profile' ? actualPosts * (1 + (options.includeComments ? Number(options.maxComments) : 0) + (options.includeReactions ? Number(options.maxReactions) : 0)) : actualPosts;
  const warnings = [id === 'reddit' && (options.includeComments || options.searchComments) && 'Posts and comments share this source’s total result limit.', id === 'x' && conversationCount > 0 && 'Account, topic, and reply filters also narrow these conversations; other participants may be excluded.', id === 'linkedin-profile' && maxRows > actualPosts && `Up to ${maxRows - actualPosts} additional engagement rows; ${maxRows} total rows requested, subject to the budget.`].filter(Boolean);
  return { targetLabel, timeframe, additions: additions.filter(Boolean).join(' · ') || 'Posts only', actualPosts, maxRows, targetCount: targets.length, warnings };
}

export function SearchView({ state = {}, busy = false, onSearch, onPreviewSearch, onRefreshActors, onNavigate }) {
  const [draft, setDraft] = useState(readDraft);
  const { query, platformIds, maxItems, budget, sourceOptions } = draft;
  const [tab, setTab] = useState(0);
  const [activeSource, setActiveSource] = useState(platformIds[0] || 'reddit');
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [focusTarget, setFocusTarget] = useState('');
  const [preview, setPreview] = useState({ status: 'idle' });
  const inFlight = useRef(false);
  const tabRefs = useRef([]);
  const sourceRefs = useRef({});
  const catalog = state.apifyCatalog || {};
  const usedActorNames = new Set((catalog.actors || []).map(actorFullName));
  const hasToken = Boolean(state.keys?.APIFY_API_TOKEN);
  const selectedSources = SOURCE_CATALOG.filter((source) => platformIds.includes(source.id));
  const shownSource = selectedSources.find((source) => source.id === activeSource) || selectedSources[0];
  const minimumSource = selectedSources.reduce((highest, source) => !highest || source.minItems > highest.minItems ? source : highest, null);
  const minimumItems = minimumSource?.minItems || 1;
  const disabled = Boolean(busy || working);
  const sourceCount = platformIds.length;
  const totalBudget = Number(budget) * sourceCount;
  const maximumItems = selectedSources.reduce((total, source) => total + sourceSummary(source, sourceOptions[source.id], maxItems).actualPosts, 0);
  const datasets = Array.isArray(result?.datasets) ? result.datasets : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const recentDatasets = (state.datasets || []).filter((dataset) => (state.recipes || []).some((recipe) => recipe.id === dataset.recipeId && recipe.searchContext)).slice(0, 4);
  const shownDatasets = result ? datasets : recentDatasets;
  const request = React.useMemo(() => ({ query: draft.query.trim(), platformIds: draft.platformIds, sourceUrls: draft.sourceOptions['linkedin-profile'].urls, sourceOptions: Object.fromEntries(SOURCE_CATALOG.filter((source) => draft.platformIds.includes(source.id)).map((source) => [source.id, { ...draft.sourceOptions[source.id] }])), maxItems: Number(draft.maxItems), maxTotalChargeUsd: Number(draft.budget) }), [draft]);
  const requestKey = JSON.stringify(request);
  const currentPreview = preview.requestKey === requestKey ? preview : { status: 'pending' };

  useEffect(() => {
    if (tab !== 2 || !onPreviewSearch) return;
    let cancelled = false;
    setPreview({ status: 'pending', requestKey });
    const timer = setTimeout(async () => {
      try {
        const checked = await onPreviewSearch(request);
        if (!cancelled) setPreview({ status: checked?.valid ? 'ready' : 'invalid', plan: checked?.plan, error: checked?.error || (!checked ? { message: 'Could not check the search plan. Try again before running.' } : null), requestKey });
      } catch (failure) { if (!cancelled) setPreview({ status: 'invalid', error: { message: failure?.message || 'Could not check the search plan.' }, requestKey }); }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, onPreviewSearch, request, requestKey]);
  useEffect(() => { try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); setSavedLocally(true); } catch { setSavedLocally(false); } }, [draft]);
  useEffect(() => { if (focusTarget && !disabled) { const node = document.getElementById(focusTarget); node?.closest('details')?.setAttribute('open', ''); node?.focus(); setFocusTarget(''); } }, [focusTarget, tab, activeSource, disabled]);
  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); setError(''); }
  function setOption(id, key, value) {
    setDraft((current) => {
      const options = { ...current.sourceOptions[id], [key]: value };
      if (id === 'linkedin-profile' && key === 'startDate' && value) options.postedLimit = 'any';
      if (id === 'linkedin-profile' && key === 'postedLimit' && value !== 'any') options.startDate = '';
      return { ...current, sourceOptions: { ...current.sourceOptions, [id]: options } };
    });
    setError('');
  }
  function toggle(id) { setDraft((current) => ({ ...current, platformIds: current.platformIds.includes(id) ? current.platformIds.filter((value) => value !== id) : [...current.platformIds, id] })); setError(''); }
  function reveal(message, nextTab, sourceId, fieldId) { setError(message); setTab(nextTab); if (sourceId) setActiveSource(sourceId); setFocusTarget(fieldId); return false; }
  function revealPreviewError(failure) {
    const field = failure?.field || '';
    const message = failure?.message || 'Review your search inputs before collecting.';
    if (field.startsWith('sourceOptions.')) { const [, sourceId, key] = field.split('.'); return reveal(message, 1, sourceId, key ? `search-${sourceId}-${key}` : `search-filter-tab-${sourceId}`); }
    if (field === 'sourceUrls') return reveal(message, 1, 'linkedin-profile', 'search-linkedin-profile-urls');
    if (field === 'query') return reveal(message, 0, null, 'search-query');
    if (field === 'platformIds') return reveal(message, 0, null, 'search-source-reddit');
    return reveal(message, 2, null, field === 'maxItems' ? 'search-max-items' : field === 'maxTotalChargeUsd' ? 'search-source-budget' : 'search-step-2');
  }
  function resetDraft() { if (disabled) return; setDraft(defaultDraft()); setTab(0); setActiveSource('reddit'); setError(''); }
  function changeTab(nextTab) { setTab(nextTab); setError(''); }
  function tabKey(event, index, labels, change, refs) {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % labels.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + labels.length - 1) % labels.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = labels.length - 1;
    if (next !== undefined) { event.preventDefault(); change(next); refs(next)?.focus(); }
  }
  function validate(includeLimits = true) {
    if (!platformIds.length) return reveal('Choose at least one source for this search.', 0, null, 'search-source-reddit');
    if (!query.trim()) {
      if (platformIds.includes('linkedin-search')) return reveal('LinkedIn search needs a topic. Enter a phrase, or select LinkedIn accounts to collect specific accounts.', 0, null, 'search-query');
      if (platformIds.includes('reddit') && !entries(sourceOptions.reddit.subreddits).length) return reveal('Add a topic or at least one subreddit to search Reddit.', 1, 'reddit', 'search-reddit-subreddits');
      if (platformIds.includes('x') && !entries(sourceOptions.x.handles).length && !entries(sourceOptions.x.conversationUrls).length) return reveal('Add a topic, X account, or conversation URL to search X.', 1, 'x', 'search-x-handles');
    }
    for (const source of selectedSources) {
      const options = sourceOptions[source.id];
      for (const key of ['subreddits', 'handles', 'urls', 'conversationUrls']) if (entries(options[key]).length > 20) return reveal(`Use 20 targets or fewer for ${source.name}.`, 1, source.id, `search-${source.id}-${key}`);
      if (source.id === 'reddit' && entries(options.subreddits).some((value) => !/^(?:r\/)?[A-Za-z0-9_]{2,21}$/.test(value) && !/^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/[A-Za-z0-9_]{2,21}\/?(?:[?#].*)?$/.test(value))) return reveal('Use subreddit names such as r/marketing or full Reddit community URLs.', 1, source.id, 'search-reddit-subreddits');
      if (source.id === 'x') {
        if (entries(options.handles).some((value) => !/^@?[A-Za-z0-9_]{1,15}$/.test(value) && !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?(?:[?#].*)?$/.test(value))) return reveal('Use X handles such as @OpenAI or full X profile URLs.', 1, source.id, 'search-x-handles');
        if (options.startDate && options.endDate && options.startDate > options.endDate) return reveal('Choose an X end date on or after the start date.', 1, source.id, 'search-x-endDate');
        if (entries(options.conversationUrls).some((value) => !/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+\/?(?:[?#].*)?$/.test(value))) return reveal('Use a complete X post URL for each conversation.', 1, source.id, 'search-x-conversationUrls');
      }
      if (source.id === 'linkedin-profile') {
        const urls = entries(options.urls);
        if (!urls.length) return reveal('Add at least one LinkedIn profile or company URL.', 1, source.id, 'search-linkedin-profile-urls');
        if (urls.some((value) => !/^https?:\/\/(?:[A-Za-z]{2,3}\.|www\.)?linkedin\.com\/(?:in|company)\/[^/?#\s]+\/?(?:[?#].*)?$/.test(value))) return reveal('Use complete linkedin.com/in/… or linkedin.com/company/… URLs.', 1, source.id, 'search-linkedin-profile-urls');
        if (includeLimits && urls.length > Number(maxItems)) return reveal('Use fewer LinkedIn targets or increase the result limit so every target can receive at least one post.', 2, null, 'search-max-items');
      }
      for (const [enabled, key, label] of [['includeComments', 'maxComments', 'comments'], ['includeReactions', 'maxReactions', 'reactions']]) if ((options[enabled] || (source.id === 'reddit' && key === 'maxComments' && options.searchComments)) && (!/^\d+$/.test(String(options[key])) || Number(options[key]) < 1 || Number(options[key]) > 100)) return reveal(`Choose 1–100 ${label} per post for ${source.name}.`, 1, source.id, `search-${source.id}-${key}`);
    }
    if (includeLimits && (!/^\d+$/.test(maxItems) || Number(maxItems) < minimumItems || Number(maxItems) > 50)) return reveal(`${minimumSource?.name || 'This search'} requires ${minimumItems}–50 results per source. Your limit has not been changed.`, 2, null, 'search-max-items');
    if (includeLimits && (!/^\d+(?:\.\d{1,2})?$/.test(budget) || Number(budget) < 0.01 || Number(budget) > 100)) return reveal('Enter an Apify budget from $0.01 to $100 per source, with at most two decimal places.', 2, null, 'search-source-budget');
    return true;
  }
  function next() { if (tab === 0) { if (!sourceCount) reveal('Choose at least one source for this search.', 0, null, 'search-source-reddit'); else changeTab(1); } else if (validate(false)) changeTab(2); }
  async function submit(event) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    if (tab !== 2) { next(); return; }
    if (!hasToken) { setError('Connect Apify in Settings before starting a search.'); return; }
    if (!validate()) return;
    inFlight.current = true; setWorking(true); setError('');
    try {
      if (onPreviewSearch) {
        const checked = await onPreviewSearch(request);
        if (!checked?.valid) { revealPreviewError(checked?.error); return; }
      }
      const response = await onSearch(request);
      if (!response) throw new Error('The search could not be started. Your inputs are still here; please try again.');
      setResult(response);
    } catch (searchError) { setError(searchError?.message || 'The search could not be completed. Please try again.'); }
    finally { inFlight.current = false; setWorking(false); }
  }
  async function refreshActors() {
    if (!onRefreshActors || refreshing) return;
    setRefreshing(true); setError('');
    try { await onRefreshActors(); } catch (refreshError) { setError(refreshError?.message || 'Could not refresh your Apify catalog.'); }
    finally { setRefreshing(false); }
  }

  return <section className="search-workspace" aria-labelledby="search-title">
    <header className="search-page-heading"><div><span className="search-eyebrow">RESEARCH WORKSPACE</span><h2 id="search-title">Find the conversations that matter.</h2><p>Choose a topic, dial in your sources, and turn real conversations into useful findings.</p></div><span className="search-connection"><span className={hasToken ? 'saved' : ''} />{hasToken ? 'Apify token saved' : 'Connection needed'}</span></header>
    {!hasToken && <div className="search-connect-prompt"><div><strong>Connect your Apify account to search.</strong><p>Add your token once in Settings to use your existing Actors.</p></div><button type="button" onClick={() => onNavigate?.('settings')}>Connect Apify<ArrowRight size={15} aria-hidden="true" /></button></div>}
    <form className="search-form" onSubmit={submit} noValidate>
      <div className="search-tab-bar" role="tablist" aria-label="Search setup steps">{TABS.map((label, index) => <button key={label} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`search-step-${index}`} aria-controls={`search-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => changeTab(index)} onKeyDown={(event) => tabKey(event, index, TABS, changeTab, (nextTab) => tabRefs.current[nextTab])}><span className="search-step-number" aria-hidden="true">{index + 1}</span><span>{label}</span></button>)}</div>
      <fieldset disabled={disabled} className="search-step-content"><legend className="sr-only">Search setup</legend>
        <section role="tabpanel" id="search-panel-0" aria-labelledby="search-step-0" hidden={tab !== 0}>
          <div className="search-section-intro"><span className="search-step-kicker">01 / THE QUESTION</span><h3>What are you researching?</h3><p>Start with a phrase, brand, or category. You can also leave this blank and collect specific accounts or communities.</p></div>
          <label className="search-query-label" htmlFor="search-query">Topic or search phrase <span>Optional for specific targets</span></label>
          <div className="search-query-box"><Search size={22} aria-hidden="true" /><input id="search-query" value={query} onChange={(event) => update('query', event.target.value)} placeholder="e.g. marketing analytics, a brand, or a product category" maxLength={500} autoComplete="off" /></div>
          <div className="search-source-heading"><div><h3>Where should we look?</h3><p>Select sources now. Choose accounts, dates, and comments in the next tab.</p></div>{onRefreshActors && <button className="search-refresh" type="button" disabled={!hasToken || refreshing || disabled} onClick={refreshActors}><RefreshCw size={13} className={refreshing ? 'spin' : ''} aria-hidden="true" />{refreshing ? 'Refreshing…' : 'Refresh catalog'}</button>}</div>
          <div className="search-platforms">{SOURCE_CATALOG.map((source) => {
            const selected = platformIds.includes(source.id); const known = usedActorNames.has(source.actorId);
            return <label key={source.id} className={`search-platform ${selected ? 'selected' : ''}`}><input id={`search-source-${source.id}`} type="checkbox" checked={selected} onChange={() => toggle(source.id)} aria-label={source.name} /><SourceIcon source={source} /><strong>{source.name}</strong><small>{source.description}</small><span className={`search-actor-state ${known ? 'known' : ''}`}>{known ? <><Check size={11} aria-hidden="true" />In your Apify</> : catalog.syncedAt ? 'Not in recent Actors' : 'Catalog not checked'}</span></label>;
          })}</div>
          {catalog.error && <p className="search-catalog-error">Catalog refresh: {catalog.error}</p>}
          <div className="search-brief-bottom"><span><ShieldCheck size={14} aria-hidden="true" />Nothing runs until you review the limits.</span><button type="button" className="search-text-button" onClick={() => changeTab(1)}>Set accounts, communities & dates<ArrowRight size={14} aria-hidden="true" /></button></div>
        </section>
        <section role="tabpanel" id="search-panel-1" aria-labelledby="search-step-1" hidden={tab !== 1}>
          <div className="search-section-intro"><span className="search-step-kicker">02 / SOURCES & FILTERS</span><h3>Make the search yours.</h3><p>Set the people, communities, and time frames you want to hear from. Each source has its own supported options.</p></div>
          {shownSource ? <div className="search-source-layout"><div className="search-source-switcher" role="tablist" aria-label="Source filters">{selectedSources.map((source, index) => <button key={source.id} type="button" ref={(node) => { sourceRefs.current[source.id] = node; }} role="tab" id={`search-filter-tab-${source.id}`} aria-controls={`search-filter-panel-${source.id}`} aria-selected={shownSource.id === source.id} tabIndex={shownSource.id === source.id ? 0 : -1} onClick={() => { setActiveSource(source.id); setError(''); }} onKeyDown={(event) => tabKey(event, index, selectedSources, (nextSource) => setActiveSource(selectedSources[nextSource].id), (nextSource) => sourceRefs.current[selectedSources[nextSource].id])}><SourceIcon source={source} /><span>{source.name}<small>{entries(sourceOptions[source.id].subreddits || sourceOptions[source.id].handles || sourceOptions[source.id].urls).length ? 'Targets added' : source.id === 'linkedin-profile' ? 'Add profile URLs' : 'Topic search'}</small></span><ArrowRight size={14} aria-hidden="true" /></button>)}</div><div className="search-filter-panel" role="tabpanel" id={`search-filter-panel-${shownSource.id}`} aria-labelledby={`search-filter-tab-${shownSource.id}`}><SourceFilters source={shownSource} options={sourceOptions[shownSource.id]} setOption={setOption} query={query} /></div></div> : <div className="search-empty"><Globe2 size={23} aria-hidden="true" /><div><strong>Choose a source to set its filters.</strong><p>Return to Search brief and select Reddit, X, or LinkedIn.</p><button type="button" onClick={() => changeTab(0)}>Choose sources</button></div></div>}
        </section>
        <section role="tabpanel" id="search-panel-2" aria-labelledby="search-step-2" hidden={tab !== 2}>
          <div className="search-section-intro"><span className="search-step-kicker">03 / REVIEW & RUN</span><h3>A clear plan before you collect.</h3><p>{query.trim() ? <>Researching <strong>“{query.trim()}”</strong></> : 'Collecting posts from your chosen accounts and communities.'}</p></div>
          <div className="search-review-sources">{selectedSources.map((source) => { const compiled = currentPreview.plan?.recipes?.find((recipe) => recipe.searchContext?.sourceId === source.id)?.searchContext; const summary = sourceSummary(source, compiled?.sourceOptions || sourceOptions[source.id], maxItems); if (compiled) { summary.actualPosts = compiled.maxItems; summary.maxRows = compiled.maxResultItems; summary.warnings = compiled.warnings || summary.warnings; } return <article className="search-review-source" key={source.id}><SourceIcon source={source} /><div><h4>{source.name}<span>Up to {Number.isFinite(summary.actualPosts) ? summary.actualPosts : '—'} {source.id === 'linkedin-profile' ? 'posts' : 'search results'}</span></h4><p className="search-review-targets">{summary.targetLabel}</p><p>{summary.timeframe}</p><small>{summary.additions}</small>{summary.warnings.map((warning) => <small className="search-review-warning" key={warning}>{warning}</small>)}{source.id === 'linkedin-profile' && <small>{summary.targetCount ? `${Math.floor(Number(maxItems) / summary.targetCount)} posts per target · ` : ''}Topic is research context, not a post filter.</small>}</div><button type="button" className="search-text-button" onClick={() => { setActiveSource(source.id); changeTab(1); }} aria-label={`Edit ${source.name} filters`}>Edit</button></article>; })}</div>
          {onPreviewSearch && <div className={`search-plan-status ${currentPreview.status}`} aria-live="polite">{currentPreview.status === 'pending' ? <><LoaderCircle size={13} className="spin" aria-hidden="true" />Checking your search plan…</> : currentPreview.status === 'ready' ? <><Check size={13} aria-hidden="true" />Plan checked · up to {currentPreview.plan.totalRequestedPosts} posts / search results · {currentPreview.plan.totalRequestedItems} total provider rows including selected engagement records</> : <><span>{currentPreview.error?.message || 'Review your inputs before running.'}</span><button type="button" className="search-text-button" onClick={() => revealPreviewError(currentPreview.error)}>Fix inputs</button></>}</div>}
          <div className="search-limits"><div><label htmlFor="search-max-items">Results per source</label><input id="search-max-items" type="number" min={minimumItems} max="50" step="1" value={maxItems} onChange={(event) => update('maxItems', event.target.value)} /><small>{minimumItems}–50 per selected source. Never increased automatically.</small></div><div><label htmlFor="search-source-budget">Apify budget per source (USD)</label><input id="search-source-budget" type="number" min="0.01" max="100" step="0.01" value={budget} onChange={(event) => update('budget', event.target.value)} /><small>A spending cap sent to each Actor.</small></div><div className="search-total"><span>Total selected budget</span><strong>{Number.isFinite(totalBudget) ? money(totalBudget) : '—'}</strong><small>{sourceCount} sources · up to {currentPreview.plan?.totalRequestedPosts ?? (Number.isFinite(maximumItems) ? maximumItems : '—')} requested posts / search results</small></div></div>
          {platformIds.includes('reddit') && <p className="search-minimum-note">Reddit requires a request for at least 10 results. Lower limits need Reddit deselected.</p>}
          {selectedSources.some((source) => sourceOptions[source.id].includeComments || sourceOptions[source.id].includeReactions) && <p className="search-extra-note">Comments, reactions, and liked-user details have the separate per-post limits shown above. LinkedIn profile results can include these extra rows in addition to the post allowance. All run spending caps remain unchanged.</p>}
          <details className="search-source-details"><summary>Coverage, pricing & collection details</summary><div>{selectedSources.map((source) => <section key={source.id}><h4>{source.name}</h4><p>{source.scopeNote}</p><a href={source.schemaUrl} target="_blank" rel="noreferrer">{source.actorId}</a></section>)}<p>Actor access and complete results are not guaranteed by appearing in your catalog. Search, start, and result fees may apply; the budget is not a price estimate. Each run has a five-minute timeout. AI chat and reports are separate.</p></div></details>
        </section>
      </fieldset>
      {error && <div className="search-error" role="alert">{error}</div>}
      <footer className="search-form-footer"><div className="search-draft-status"><span>{working ? 'Collecting from your selected sources…' : savedLocally ? 'Draft saved on this Mac' : 'Draft kept for this visit'}</span><button type="button" className="search-text-button" disabled={disabled} onClick={resetDraft}>Reset draft</button></div><div className="search-footer-actions">{tab > 0 && <button type="button" className="ghost" disabled={disabled} onClick={() => changeTab(tab - 1)}><ArrowLeft size={14} aria-hidden="true" />Back</button>}{tab < 2 ? <button type="button" disabled={disabled} onClick={next}>{tab === 0 ? 'Choose targets & filters' : 'Review search'}<ArrowRight size={15} aria-hidden="true" /></button> : <button type="submit" disabled={disabled || !hasToken || !sourceCount}>{working ? <><LoaderCircle size={16} className="spin" aria-hidden="true" />Collecting posts…</> : <><Search size={16} aria-hidden="true" />Search selected sources</>}</button>}</div></footer>
      {tab === 2 && <div className="search-paid-note"><ShieldCheck size={13} aria-hidden="true" />Starts {sourceCount} paid Apify {sourceCount === 1 ? 'run' : 'runs'} with the limits above.</div>}
    </form>
    <section className="search-results" aria-labelledby="search-results-title"><div className="search-results-heading"><div><h3 id="search-results-title">{result ? 'Your search results' : 'Recent search collections'}</h3><p>{working ? 'Results will appear here when the source runs finish.' : 'Review the evidence, ask a question, or turn a collection into a report.'}</p></div>{shownDatasets.length > 0 && <span>{shownDatasets.length} collections</span>}</div>
      {errors.map((item, index) => <div className="search-error" role="alert" key={`${item.sourceId || 'source'}-${index}`}><strong>{SOURCE_CATALOG.find((source) => source.id === item.sourceId)?.name || item.sourceId || 'Source'}: </strong>{item.message || item.error || String(item)}</div>)}
      {shownDatasets.length ? <div className="search-result-list">{shownDatasets.map((dataset) => <article className="search-result" key={dataset.id}><span className="search-result-icon"><Database size={20} aria-hidden="true" /></span><div><h4>{dataset.name || 'Search collection'}</h4><p>{Number(dataset.itemCount) || 0} collected rows · {dataset.platform || 'web'}</p></div><div className="search-result-actions"><button className="ghost" type="button" onClick={() => onNavigate?.('datasets', { datasetId: dataset.id })}>Open data</button><button type="button" onClick={() => onNavigate?.('chat', { datasetId: dataset.id })}>Review findings<ArrowRight size={14} aria-hidden="true" /></button></div></article>)}</div> : <div className="search-empty"><Globe2 size={23} aria-hidden="true" /><div><strong>{result ? 'No collections returned from this search.' : 'Your next question starts here.'}</strong><p>{result ? 'Check source messages above, adjust your filters, or choose other sources.' : 'Your collected posts will appear here, ready to explore.'}</p></div></div>}
      <div className="search-evidence-reminder"><FileText size={14} aria-hidden="true" /><span>A search is a sample of public posts. Review its sources before drawing conclusions about a whole market.</span></div>
    </section>
  </section>;
}
