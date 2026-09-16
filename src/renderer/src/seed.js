export const CLUSTERS = [
  {
    name: 'AI Search Disruption',
    score: 94,
    trend: '+18%',
    owner: 'Market scan',
    summary: 'Search behavior shifting from ranked pages to cited AI answers.',
    topics: ['AI search', 'answer engines', 'citation gaps', 'SEO decline'],
    signals: ['Reddit objections', 'LinkedIn founder posts', 'X launch threads'],
  },
  {
    name: 'WebMCP Protocol',
    score: 87,
    trend: '+31%',
    owner: 'Protocol desk',
    summary: 'Open protocol discussion is moving from developer circles into product strategy.',
    topics: ['MCP', 'agents', 'tool routing', 'browser control'],
    signals: ['GitHub repos', 'technical posts', 'builder communities'],
  },
  {
    name: 'LLM Citation Strategy',
    score: 81,
    trend: '+12%',
    owner: 'Content team',
    summary: 'Brands want evidence that large models cite them and their competitors.',
    topics: ['citations', 'brand mentions', 'authority', 'source attribution'],
    signals: ['Agency positioning', 'founder essays', 'newsletter mentions'],
  },
  {
    name: 'Content Attribution Crisis',
    score: 76,
    trend: '+9%',
    owner: 'Reports',
    summary: 'Creators and publishers are worried that scraped content becomes unattributed answers.',
    topics: ['copyright', 'publisher traffic', 'summaries', 'AI policy'],
    signals: ['News comments', 'creator threads', 'policy discussions'],
  },
];

export const CALENDAR = [
  { date: 'Mon', title: 'Subreddit pulse', channel: 'reddit', status: 'Queued' },
  { date: 'Tue', title: 'LinkedIn founder scan', channel: 'linkedin', status: 'Draft' },
  { date: 'Wed', title: 'X launch objections', channel: 'x', status: 'Needs tags' },
  { date: 'Thu', title: 'Competitive citation report', channel: 'report', status: 'Codex' },
  { date: 'Fri', title: 'Lead list export', channel: 'sales', status: 'Ready' },
];

export const COMPETITORS = [
  { name: 'Perplexity agencies', channel: 'AI search', share: 32, move: 'Publishing answer-engine audits' },
  { name: 'Social listening suites', channel: 'Enterprise', share: 26, move: 'Bundling Reddit and X trend summaries' },
  { name: 'SEO platforms', channel: 'Search', share: 21, move: 'Reframing as LLM visibility tools' },
  { name: 'Boutique scrapers', channel: 'Data', share: 13, move: 'Selling per-platform exports' },
];

export const PROMPTS = [
  'Market scan: find topics, objections, buying signals, and proof points.',
  'Account intelligence: summarize a profile, recurring themes, and likely needs.',
  'Subreddit pulse: tag pain, urgency, product mentions, and trend velocity.',
  'Competitive report: compare offers, claims, sentiment, and content gaps.',
];

export const SIGNAL_FALLBACK = [
  { source: 'reddit', intent: 'Objection', text: 'Teams want AI search monitoring but do not trust generic dashboards.', heat: 92 },
  { source: 'linkedin', intent: 'Buying signal', text: 'Founders are asking how to know if ChatGPT recommends their brand.', heat: 88 },
  { source: 'x', intent: 'Trend', text: 'Agent tooling threads are clustering around MCP and local workflow control.', heat: 84 },
  { source: 'report', intent: 'Gap', text: 'Competitors describe AI visibility, but few show account-level evidence.', heat: 79 },
];
