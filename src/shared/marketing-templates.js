const ACTOR_ID = 'apify/website-content-crawler';
const SCHEMA_URL = 'https://apify.com/apify/website-content-crawler/input-schema';

export const MARKETING_TEMPLATES = [
  {
    id: 'competitor-positioning',
    name: 'Competitor positioning brief',
    description: 'Compare how brands describe their product, audience, and value. Find a position worth testing.',
    audience: 'Product marketing',
    decisionPlaceholder: 'Where could our messaging stand apart? Our pages are on example.com; the other URLs are competitors.',
    outputPreview: 'A source-backed comparison you can bring to a positioning discussion.',
    sections: [
      { title: 'Positioning at a glance', description: 'Compare the audiences, promises, proof, and calls to action stated on each page.' },
      { title: 'Evidence that matters', description: 'Review specific excerpts with their source links and collection time.' },
      { title: 'Angles to test', description: 'Separate observed differences from suggested positioning hypotheses.' },
      { title: 'Open questions', description: 'See missing sources and what this snapshot cannot establish.' },
    ],
  },
  {
    id: 'campaign-message-audit',
    name: 'Campaign message audit',
    description: 'Check whether your campaign pages tell a consistent story and give your audience a clear next step.',
    audience: 'Campaign marketing',
    decisionPlaceholder: 'Do these launch pages explain the same offer and make the next step clear?',
    outputPreview: 'A focused editing brief for your next campaign review.',
    sections: [
      { title: 'Message consistency', description: 'Compare the offer, audience, proof, and calls to action across your pages.' },
      { title: 'Page-by-page findings', description: 'Connect unclear or conflicting language to the exact source text.' },
      { title: 'Suggested edits', description: 'Review draft rewrites and the reason for each change.' },
      { title: 'What to validate', description: 'Keep copy recommendations separate from unmeasured conversion claims.' },
    ],
  },
  {
    id: 'launch-research',
    name: 'Launch research pack',
    description: 'Bring product, competitor, and market pages together to sharpen your launch story.',
    audience: 'Product and launch teams',
    decisionPlaceholder: 'Which launch message is most distinctive and best supported by these sources?',
    outputPreview: 'An evidence-led starting point for a launch brief.',
    sections: [
      { title: 'What the sources establish', description: 'Summarize relevant product facts and market claims with attribution.' },
      { title: 'Messages in the market', description: 'Identify repeated themes and potential differences in the supplied pages.' },
      { title: 'Launch hypotheses', description: 'Suggest audiences and angles to investigate, with evidence and limitations.' },
      { title: 'Research gaps', description: 'List questions that need customer interviews or additional sources.' },
    ],
  },
{
  "id": "account-research",
  "name": "ABM account research",
  "description": "Prepare a relevant account conversation using public company evidence and your saved ideal customer profile.",
  "audience": "Account-based marketing",
  "category": "Accounts",
  "requiresIcp": true,
  "decisionPlaceholder": "Does this account fit our ICP, and which evidenced business priority should shape our campaign?",
  "outputPreview": "An account brief with explicit fit criteria, unknowns, and conversation hypotheses.",
  "sections": [
    {
      "title": "Account facts",
      "description": "Organize company information and dated developments with source citations."
    },
    {
      "title": "Fit against our ICP",
      "description": "Assess the criteria in your saved profile; keep unsupported criteria unknown."
    },
    {
      "title": "Relevant conversation",
      "description": "Propose a problem hypothesis, proof asset, and discovery questions."
    },
    {
      "title": "Disqualifiers and unknowns",
      "description": "Surface contradictory evidence without inventing budget or purchase intent."
    }
  ],
  "inputSummary": "Saved brand profile with ICP, research decision, and explicit account page URLs",
  "scope": "Public account pages only. No contact discovery, hidden intent score, or outreach."
},
{
  "id": "voice-of-customer",
  "name": "Voice of customer brief",
  "description": "Turn customer language into themes, objections, and campaign hypotheses you can review.",
  "audience": "Customer insights and brand teams",
  "category": "Customers",
  "sourceMode": "dataset",
  "entryView": "reports",
  "outputPreview": "A sample-aware customer insight brief with cited language and contrasting views.",
  "inputSummary": "An existing collection or authorized review, interview, or support export",
  "scope": "Uses your supplied records. Frequencies describe this sample, not the whole market.",
  "sections": [
    {
      "title": "Sample and coverage",
      "description": "Describe source types, time window, missing fields, and duplicates."
    },
    {
      "title": "Needs and objections",
      "description": "Group supported themes with record counts and cited examples."
    },
    {
      "title": "Contradictions",
      "description": "Preserve minority experiences and conflicting customer language."
    },
    {
      "title": "Campaign hypotheses",
      "description": "Suggest evidence-linked messaging tests and validation questions."
    }
  ]
},
{
  "id": "content-opportunity",
  "name": "Content and SERP opportunities",
  "description": "Find questions worth answering from supplied search results or selected content pages.",
  "audience": "Content and search teams",
  "category": "Content",
  "sourceMode": "dataset",
  "supportsPublicPages": true,
  "entryView": "reports",
  "decisionPlaceholder": "Which buyer question deserves a stronger answer on our site? Identify which supplied pages are ours.",
  "outputPreview": "Prioritized content brief candidates with the evidence each would need.",
  "inputSummary": "Imported SERP rows with query context, an existing dataset, or explicit content page URLs",
  "scope": "Ranks need supplied SERP evidence. Page-only collections cannot establish rank, search volume, traffic, or AI visibility.",
  "sections": [
    {
      "title": "Query and source coverage",
      "description": "Preserve query, country, language, device, and capture date when supplied."
    },
    {
      "title": "Existing answers",
      "description": "Describe topics and formats actually visible in the supplied evidence."
    },
    {
      "title": "Content hypotheses",
      "description": "Propose distinct arguments, readers, proof, and calls to action."
    },
    {
      "title": "Validation plan",
      "description": "State what needs first-party analytics or further research."
    }
  ]
},
{
  "id": "ad-creative-research",
  "name": "Advertising message research",
  "description": "Study supplied ad copy and propose original angles for your next creative test.",
  "audience": "Paid media and creative teams",
  "category": "Campaigns",
  "sourceMode": "dataset",
  "entryView": "reports",
  "outputPreview": "A message-pattern brief and original test concepts grounded in the supplied ads.",
  "inputSummary": "Imported ad text or existing ad records with advertiser and source references",
  "scope": "Text analysis only unless inspected media evidence is supplied. No inferred spend, winners, conversion, or ROAS.",
  "sections": [
    {
      "title": "Ad sample and identities",
      "description": "List advertiser, dates, source links, and unavailable fields."
    },
    {
      "title": "Message patterns",
      "description": "Compare promises, offers, proof, and calls to action in the text."
    },
    {
      "title": "Original test concepts",
      "description": "Develop new angle hypotheses with a proposed controlled test."
    },
    {
      "title": "Evidence and limits",
      "description": "Keep unseen imagery and video separate from supported text observations."
    }
  ]
},
{
  "id": "weekly-competitor-changes",
  "name": "Weekly competitor changes",
  "description": "Compare two saved snapshots and decide which observed changes deserve action.",
  "audience": "Competitive intelligence teams",
  "category": "Competitive",
  "sourceMode": "comparison",
  "entryView": "compare",
  "outputPreview": "A reviewed before-and-after brief with coverage, evidence, and proposed actions.",
  "inputSummary": "Two comparable saved datasets or a first dataset to establish a baseline",
  "scope": "Manual snapshot comparison. The first collection is a baseline; missing pages are not proof of removal.",
  "sections": [
    {
      "title": "Snapshot coverage",
      "description": "Compare source identities, capture dates, and unavailable pages."
    },
    {
      "title": "Material changes",
      "description": "Show before-and-after excerpts with both source dates."
    },
    {
      "title": "Potential implications",
      "description": "Separate observed edits from competitive interpretation."
    },
    {
      "title": "Actions to review",
      "description": "Propose collateral updates and identify changes needing confirmation."
    }
  ]
},
].map((template) => {
  const sourceMode = template.sourceMode || 'public-pages';
  const supportsPublicPages = sourceMode === 'public-pages' || template.supportsPublicPages === true;
  return {
    category: template.id === 'competitor-positioning' ? 'Competitive' : 'Campaigns',
    inputSummary: 'Your brand, research decision, and up to 15 public page URLs',
    scope: 'Selected page text only. No conversion measurement or historical changes from a single snapshot.',
    ...template, sourceMode, supportsPublicPages,
    actorId: supportsPublicPages ? ACTOR_ID : '',
    schemaUrl: supportsPublicPages ? SCHEMA_URL : '',
    schemaCheckedAt: '2026-09-27', templateVersion: 1,
  };
});

function invalid(field, message) {
  const error = new Error(message);
  error.field = field;
  throw error;
}

function textField(value, field, label, maxLength, required = true) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) invalid(field, `Add ${label}.`);
  if (text.length > maxLength) invalid(field, `Keep ${label} to ${maxLength} characters or fewer.`);
  return text;
}

export function snapshotBrandProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const snapshot = {};
  for (const field of ['id', 'name', 'offering', 'audience', 'positioning', 'icp', 'brandVoice', 'forbiddenClaims']) {
    snapshot[field] = typeof profile[field] === 'string' ? profile[field].trim() : '';
  }
  snapshot.competitors = Array.isArray(profile.competitors) ? profile.competitors.map((competitor) => ({
    name: typeof competitor?.name === 'string' ? competitor.name.trim() : '',
    domain: typeof competitor?.domain === 'string' ? competitor.domain.trim() : '',
  })) : [];
  return snapshot;
}

export function buildMarketingRecipe(templateId, values = {}) {
  const template = MARKETING_TEMPLATES.find((item) => item.id === templateId);
  if (!template) invalid('templateId', 'Choose an available marketing template.');
  if (!template.supportsPublicPages) invalid('templateId', 'This playbook uses existing data or snapshot comparison. Open it from the playbook library.');
  const brandContext = snapshotBrandProfile(values.brandProfile);
  if (template.requiresIcp && !brandContext?.icp) invalid('brandProfile', 'Choose a saved brand profile with an ideal customer profile (ICP) for account research.');
  const brand = textField(values.brand, 'brand', 'a project or brand name', 120);
  const decision = textField(values.decision, 'decision', 'the decision this research should help you make', 2000);
  const audience = textField(values.audience, 'audience', 'the audience', 800, false);
  const lines = Array.isArray(values.sourceUrls) ? values.sourceUrls : String(values.sourceUrls || '').split(/\r?\n/);
  const sourceUrls = [];
  for (const line of lines) {
    if (typeof line !== 'string') invalid('sourceUrls', 'Enter one complete http:// or https:// page URL per line.');
    const raw = line.trim();
    if (!raw) continue;
    let url;
    try { url = new URL(raw); } catch { invalid('sourceUrls', 'Enter one complete http:// or https:// page URL per line.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !/^https?:\/\//i.test(raw)) invalid('sourceUrls', 'Use only http:// or https:// page URLs.');
    if (url.username || url.password) invalid('sourceUrls', 'Remove usernames and passwords from your page URLs. Use public pages.');
    url.hash = '';
    if (!sourceUrls.includes(url.href)) sourceUrls.push(url.href);
  }
  if (!sourceUrls.length) invalid('sourceUrls', 'Add at least one public page URL.');
  if (sourceUrls.length > 15) invalid('sourceUrls', 'Use 15 different page URLs or fewer for this starter.');
  const rawCap = values.maxTotalChargeUsd ?? 2;
  const maxTotalChargeUsd = Number(rawCap);
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(rawCap).trim()) || !Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd <= 0 || maxTotalChargeUsd > 100) {
    invalid('maxTotalChargeUsd', 'Enter a spending cap from $0.01 to $100, with no more than two decimal places.');
  }
  return {
    name: `${brand} · ${template.name}`,
    platform: 'web',
    actorId: ACTOR_ID,
    taskId: '',
    input: {
      startUrls: sourceUrls.map((url) => ({ url })),
      crawlerType: 'playwright:adaptive',
      maxCrawlDepth: 0,
      maxCrawlPages: sourceUrls.length,
      maxResults: sourceUrls.length,
      maxConcurrency: 3,
      maxRequestRetries: 2,
      respectRobotsTxtFile: true,
      saveMarkdown: true,
      summarize: false,
      proxyConfiguration: { useApifyProxy: true },
    },
    mapper: { text: 'markdown', author: 'metadata.author', url: 'url', externalId: 'url' },
    proxyNote: 'Collect only the supplied public pages with Apify Website Content Crawler. Robots rules are respected; blocked or unavailable pages may be missing.',
    marketingBrief: { templateId, reportPresetId: templateId, brand, decision, audience, sourceUrls, templateVersion: 1, ...(brandContext ? { brandProfileId: brandContext.id, brandContext } : {}) },
    runOptions: { maxTotalChargeUsd, timeoutSecs: 300 },
  };
}
